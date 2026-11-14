import { expect, type Page } from '@playwright/test'
import { fromBase64Url, toBase64Url } from '../../src/crypto/encoding'
import { encryptPost } from '../../src/crypto/envelope'
import { deriveDataKey, deriveKeyProof, wrapWithPassphrase, wrapWithRecoveryKey } from '../../src/crypto/keys'
import { formatRecoveryKey } from '../../src/crypto/recovery-key'
import { installApiMock, type ApiMockOptions, type MockKeyring } from '../mock'

/**
 * 暗号化チャネルの E2E の fixture（test-plan.md「前提となる E2E 環境」）。
 *
 * 鍵束と暗号文は、テスト用のパスフレーズと復旧キーから、ここで WebCrypto を使って組み立てる。
 * 暗号文のバイナリはリポジトリに置かない。組み立てには、アプリと同じ暗号モジュール
 * （src/crypto）を使うので、「別の端末のクライアントが作った鍵束と暗号文」と同じものになる。
 */

/** fixture の鍵束を包んだパスフレーズ。 */
export const TEST_PASSPHRASE = 'e2e-correct-horse-battery'
/** 解錠に失敗させるための、12 文字以上の誤ったパスフレーズ。 */
export const WRONG_PASSPHRASE = 'e2e-wrong-horse-battery'
/** 初期設定や変更で、テストが新しく設定するパスフレーズ。 */
export const NEW_PASSPHRASE = 'e2e-new-passphrase-2026'

/** 決まった値の 32 バイト。テストのたびに同じ鍵と復旧キーになるようにする。 */
function fixedBytes(seed: number, length = 32): Uint8Array<ArrayBuffer> {
  return Uint8Array.from({ length }, (_, index) => (seed * 37 + index * 11) & 0xff)
}

/** fixture の鍵束を包んだ復旧キー（表示形式）。 */
export const TEST_RECOVERY_KEY = formatRecoveryKey(fixedBytes(1))

const TEST_KEY_ID = '0e2e0000-0000-4000-8000-000000000001'
const FOREIGN_KEY_ID = '0e2e0000-0000-4000-8000-0000000000ff'

/** 暗号化チャネル `secret` のポスト。Markdown・コードブロック・Mermaid を 1 件に含める。 */
export const SECRET_RICH_BODY = [
  '**秘密の太字** のメモ',
  '',
  '```ts',
  'const secretAnswer: number = 42',
  '```',
  '',
  '```mermaid',
  'graph TD',
  '  S[秘密の開始] --> E[秘密の終了]',
  '```',
].join('\n')
/** 暗号化チャネル `secret` の、返信を持つポストと、その返信。 */
export const SECRET_THREAD_ROOT = '秘密のスレッドの親'
export const SECRET_THREAD_REPLY = '秘密のスレッドへの返信'
/** mock:encryption-tampered-post の、正しく読めるポスト。 */
export const SECRET_INTACT_BODY = '改ざんされていない秘密'
/** 改ざんした暗号文と、別の鍵の暗号文の元の平文。画面に出てはならない。 */
export const TAMPERED_PLAINTEXT = '改ざんされた秘密'
export const FOREIGN_PLAINTEXT = '別の鍵の秘密'
/** 非暗号化チャネル `inbox` の既存ポスト。 */
export const INBOX_BODY = '平文チャネルのポスト'

export type Workspace = {
  keyId: string
  keyring: MockKeyring
  /** マスター鍵の値（base64url）。記憶した鍵を事前に置くのと、漏えいの検査にだけ使う */
  masterKey: string
  encrypt(plaintext: string): Promise<string>
}

/** パスフレーズと復旧キーで包んだ鍵束（POST /v1/encryption/keyring と同じ内容）を組み立てる。 */
export async function buildWorkspace(options: { seed?: number; keyId?: string } = {}): Promise<Workspace> {
  const keyId = options.keyId ?? TEST_KEY_ID
  const master = fixedBytes(options.seed ?? 2)
  const dataKey = await deriveDataKey(master, keyId)
  return {
    keyId,
    keyring: {
      keyId,
      keyProof: await deriveKeyProof(master, keyId),
      passphraseWrap: await wrapWithPassphrase(master, TEST_PASSPHRASE, keyId),
      recoveryWrap: await wrapWithRecoveryKey(master, fixedBytes(1), keyId),
    },
    masterKey: toBase64Url(master),
    encrypt: (plaintext) => encryptPost(dataKey, keyId, plaintext),
  }
}

/** 暗号文の認証タグの手前を 1 バイトだけ書き換える。形式は正しいまま、復号だけが失敗する。 */
export function tamper(ciphertext: string): string {
  const parts = ciphertext.split('.')
  const sealed = fromBase64Url(parts[3]!)
  sealed[0] = sealed[0]! ^ 0x01
  parts[3] = toBase64Url(sealed)
  return parts.join('.')
}

/** 別の端末が別の鍵（別の鍵 ID）で作った暗号文。 */
export async function foreignCiphertext(plaintext: string): Promise<string> {
  const other = await buildWorkspace({ seed: 3, keyId: FOREIGN_KEY_ID })
  return other.encrypt(plaintext)
}

export type EncryptionFixture =
  | 'unconfigured'
  | 'locked'
  | 'unlocked'
  | 'setup-conflict'
  | 'tampered-post'

/**
 * mock:encryption-* の初期状態を作る。どの fixture にも、非暗号化チャネル `inbox` を置く。
 *
 * - `unconfigured`: 鍵束が無い
 * - `locked`: 鍵束と、暗号化チャネル `secret`（Markdown・コード・Mermaid のポストと、返信付きのポスト）
 * - `unlocked`: `locked` に加えて、記憶した鍵をブラウザ（IndexedDB）に事前に置く
 * - `setup-conflict`: 別の端末が鍵束を登録済み。初期設定の確定（POST）が 409 になるまでは未設定に見える
 * - `tampered-post`: 鍵束と、`secret` に正しいポスト・改ざんした暗号文・別の鍵の暗号文
 *
 * `unlocked` はページを同じオリジンの空のページに置いたまま返す。続けて `page.goto('/')` で開く。
 */
export async function installEncryptionMock(page: Page, fixture: EncryptionFixture, options: ApiMockOptions = {}) {
  const workspace = await buildWorkspace()
  const keyringOption =
    fixture === 'unconfigured' ? {} : { keyring: workspace.keyring, conflict: fixture === 'setup-conflict' }
  const mock = await installApiMock(page, { ...options, encryption: keyringOption })
  const inbox = mock.seedChannel('inbox', [INBOX_BODY])
  const seeded = {
    inbox: inbox.channel,
    secret: null as null | ReturnType<typeof mock.seedEncryptedChannel>,
  }
  if (fixture === 'locked' || fixture === 'unlocked') {
    seeded.secret = mock.seedEncryptedChannel('secret', [
      await workspace.encrypt(SECRET_RICH_BODY),
      await workspace.encrypt(SECRET_THREAD_ROOT),
    ])
    mock.seedReply(seeded.secret.posts[1]!.id, { ciphertext: await workspace.encrypt(SECRET_THREAD_REPLY) })
  }
  if (fixture === 'tampered-post') {
    seeded.secret = mock.seedEncryptedChannel('secret', [
      await workspace.encrypt(SECRET_INTACT_BODY),
      tamper(await workspace.encrypt(TAMPERED_PLAINTEXT)),
      await foreignCiphertext(FOREIGN_PLAINTEXT),
    ])
  }
  if (fixture === 'unlocked') await rememberKeyInBrowser(page, workspace)
  return { mock, workspace, ...seeded }
}

/**
 * 「この端末で記憶する」で解錠した後と同じ状態を、ブラウザの IndexedDB（`postall-keys`）に作る。
 * アプリの browser adapter（src/platform/key-store.ts）と同じく、取り出せない暗号鍵を置く。
 */
export async function rememberKeyInBrowser(page: Page, workspace: Pick<Workspace, 'keyId' | 'masterKey'>) {
  await page.goto('/__e2e__/blank')
  await page.evaluate(async ({ keyId, masterKey }) => {
    const raw = Uint8Array.from(atob(masterKey.replace(/-/g, '+').replace(/_/g, '/')), (char) => char.charCodeAt(0))
    const encoder = new TextEncoder()
    const base = await crypto.subtle.importKey('raw', raw, 'HKDF', false, ['deriveKey'])
    // src/crypto/keys.ts の deriveDataKey と同じ導出（info は DATA_KEY_INFO）。
    const dataKey = await crypto.subtle.deriveKey(
      { name: 'HKDF', hash: 'SHA-256', salt: encoder.encode(keyId), info: encoder.encode('postall:pe1:enc') },
      base,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    )
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('postall-keys', 1)
      req.onupgradeneeded = () => req.result.createObjectStore('keys')
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('keys', 'readwrite')
      tx.objectStore('keys').put({ keyId, dataKey }, 'workspace')
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
    db.close()
  }, { keyId: workspace.keyId, masterKey: workspace.masterKey })
}

/** ブラウザ（IndexedDB）に記憶した鍵の記録。鍵は取り出せないので、種類と属性だけを返す。 */
export async function readRememberedKey(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('postall-keys', 1)
      req.onupgradeneeded = () => req.result.createObjectStore('keys')
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    const record = await new Promise<unknown>((resolve, reject) => {
      const req = db.transaction('keys', 'readonly').objectStore('keys').get('workspace')
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    db.close()
    if (!record) return null
    const { keyId, dataKey } = record as { keyId: string; dataKey: CryptoKey }
    let exported: string
    try {
      await crypto.subtle.exportKey('raw', dataKey)
      exported = 'exported'
    } catch (err) {
      exported = err instanceof Error ? err.name : String(err)
    }
    return { keyId, type: dataKey.type, extractable: dataKey.extractable, exported }
  })
}

/**
 * 端末のストレージ（localStorage・sessionStorage・IndexedDB の全レコード）を文字列にして返す。
 * 平文やパスフレーズが残っていないかの検査に使う。CryptoKey は値を持たないので種類だけを書く。
 */
export async function dumpDeviceStorage(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const out: string[] = []
    for (const area of [localStorage, sessionStorage]) {
      for (let i = 0; i < area.length; i += 1) {
        const key = area.key(i)!
        out.push(`${key}=${area.getItem(key)}`)
      }
    }
    const describe = (value: unknown): string => {
      if (value instanceof CryptoKey) return `[CryptoKey ${value.type}]`
      if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
        const bytes = value instanceof ArrayBuffer ? new Uint8Array(value) : new Uint8Array(value.buffer)
        return `[bytes ${btoa(String.fromCharCode(...bytes))}]`
      }
      if (value && typeof value === 'object') {
        return `{${Object.entries(value).map(([k, v]) => `${k}:${describe(v)}`).join(',')}}`
      }
      return JSON.stringify(value)
    }
    for (const info of await indexedDB.databases()) {
      if (!info.name) continue
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open(info.name!)
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
      })
      for (const store of Array.from(db.objectStoreNames)) {
        const entries = await new Promise<Array<[IDBValidKey, unknown]>>((resolve, reject) => {
          const tx = db.transaction(store, 'readonly')
          const keysReq = tx.objectStore(store).getAllKeys()
          const valuesReq = tx.objectStore(store).getAll()
          tx.oncomplete = () => resolve(keysReq.result.map((key, index) => [key, valuesReq.result[index]]))
          tx.onerror = () => reject(tx.error)
        })
        for (const [key, value] of entries) out.push(`${info.name}/${store}/${String(key)}=${describe(value)}`)
      }
      db.close()
    }
    return out.join('\n')
  })
}

/** 解錠ダイアログで、パスフレーズ（既定）か復旧キーを入れて解錠する。 */
export async function unlockWith(
  page: Page,
  secret: string,
  options: { recovery?: boolean; remember?: boolean } = {},
) {
  const form = page.getByTestId('encryption-unlock')
  await expect(form).toBeVisible()
  if (options.recovery) await form.getByTestId('unlock-use-recovery').click()
  await form.getByTestId('unlock-secret').fill(secret)
  if (options.remember) await form.getByTestId('unlock-remember').check()
  await form.getByTestId('unlock-submit').click()
}

/** 初期設定のダイアログを、パスフレーズの 2 回入力と復旧キーの保管確認まで進めて完了する。 */
export async function completeSetup(page: Page, passphrase = NEW_PASSPHRASE) {
  const setup = page.getByTestId('encryption-setup')
  await expect(setup).toBeVisible()
  await setup.getByTestId('setup-passphrase').fill(passphrase)
  await setup.getByTestId('setup-passphrase-confirm').fill(passphrase)
  await setup.getByTestId('setup-continue').click()
  const recovery = page.getByTestId('encryption-setup-recovery')
  const recoveryKey = (await recovery.getByTestId('setup-recovery-key').textContent()) ?? ''
  await recovery.getByTestId('setup-recovery-ack').check()
  await recovery.getByTestId('setup-finish').click()
  await expect(page.getByTestId('encryption-dialog')).toHaveCount(0)
  return recoveryKey
}
