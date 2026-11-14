import { describe, expect, it } from 'vitest'
import { toBase64Url } from './encoding'
import {
  PBKDF2_ITERATIONS,
  UnwrapError,
  deriveDataKey,
  deriveKeyProof,
  generateMasterKey,
  passphraseLength,
  unwrapMasterKey,
  wrapWithPassphrase,
  wrapWithRecoveryKey,
} from './keys'
import { decryptPost, encryptPost, UndecryptableError } from './envelope'
import { generateRecoveryKey } from './recovery-key'

const KEY_ID = '0b6c5c1e-8d2a-4f7e-9c3b-1a2b3c4d5e6f'
const PASSPHRASE = 'correct horse battery staple'
// テストの所要時間を抑えるため、包みの往復は少ない反復で確かめる。既定値は別のテストで見る。
const FAST = { iterations: 1_000 }

describe('keys', () => {
  it('round-trips the master key through the passphrase and the recovery key', async () => {
    const master = generateMasterKey()
    const recoveryKey = generateRecoveryKey()
    const byPassphrase = await wrapWithPassphrase(master, PASSPHRASE, KEY_ID, FAST)
    const byRecovery = await wrapWithRecoveryKey(master, recoveryKey, KEY_ID)

    const fromPassphrase = await unwrapMasterKey(byPassphrase, { kind: 'passphrase', passphrase: PASSPHRASE }, KEY_ID)
    const fromRecovery = await unwrapMasterKey(byRecovery, { kind: 'recovery', recoveryKey }, KEY_ID)

    expect(Array.from(fromPassphrase)).toEqual(Array.from(master))
    expect(Array.from(fromRecovery)).toEqual(Array.from(master))
  })

  it('treats differently composed passphrases as the same input', async () => {
    const master = generateMasterKey()
    const composed = 'ぱすふれーずテスト用です'
    const decomposed = composed.normalize('NFD')
    expect(decomposed).not.toBe(composed)
    const wrap = await wrapWithPassphrase(master, composed, KEY_ID, FAST)
    const unwrapped = await unwrapMasterKey(wrap, { kind: 'passphrase', passphrase: decomposed }, KEY_ID)
    expect(Array.from(unwrapped)).toEqual(Array.from(master))
    expect(passphraseLength(decomposed)).toBe(passphraseLength(composed))
  })

  it('rejects a wrong passphrase, a wrong recovery key, a tampered wrap and another key id', async () => {
    const master = generateMasterKey()
    const recoveryKey = generateRecoveryKey()
    const byPassphrase = await wrapWithPassphrase(master, PASSPHRASE, KEY_ID, FAST)
    const byRecovery = await wrapWithRecoveryKey(master, recoveryKey, KEY_ID)

    await expect(
      unwrapMasterKey(byPassphrase, { kind: 'passphrase', passphrase: `${PASSPHRASE}!` }, KEY_ID),
    ).rejects.toBeInstanceOf(UnwrapError)
    await expect(
      unwrapMasterKey(byRecovery, { kind: 'recovery', recoveryKey: generateRecoveryKey() }, KEY_ID),
    ).rejects.toBeInstanceOf(UnwrapError)
    const flipped = byPassphrase.wrapped.startsWith('A') ? `B${byPassphrase.wrapped.slice(1)}` : `A${byPassphrase.wrapped.slice(1)}`
    await expect(
      unwrapMasterKey({ ...byPassphrase, wrapped: flipped }, { kind: 'passphrase', passphrase: PASSPHRASE }, KEY_ID),
    ).rejects.toBeInstanceOf(UnwrapError)
    await expect(
      unwrapMasterKey(byPassphrase, { kind: 'passphrase', passphrase: PASSPHRASE }, '11111111-1111-4111-8111-111111111111'),
    ).rejects.toBeInstanceOf(UnwrapError)
    await expect(
      unwrapMasterKey(byRecovery, { kind: 'passphrase', passphrase: PASSPHRASE }, KEY_ID),
    ).rejects.toBeInstanceOf(UnwrapError)
  })

  it('derives a data key that cannot be exported', async () => {
    const dataKey = await deriveDataKey(generateMasterKey(), KEY_ID)
    expect(dataKey.extractable).toBe(false)
    expect(dataKey.algorithm).toMatchObject({ name: 'AES-GCM', length: 256 })
    await expect(crypto.subtle.exportKey('raw', dataKey)).rejects.toThrow()
  })

  it('stores the wrap parameters so that they can be strengthened later', async () => {
    const master = generateMasterKey()
    const wrap = await wrapWithPassphrase(master, PASSPHRASE, KEY_ID)
    expect(wrap).toMatchObject({ kdf: 'pbkdf2-sha256', iterations: PBKDF2_ITERATIONS })
    expect(PBKDF2_ITERATIONS).toBe(600_000)

    const restored = JSON.parse(JSON.stringify(wrap)) as typeof wrap
    const unwrapped = await unwrapMasterKey(restored, { kind: 'passphrase', passphrase: PASSPHRASE }, KEY_ID)
    expect(Array.from(unwrapped)).toEqual(Array.from(master))

    const stronger = await wrapWithPassphrase(master, PASSPHRASE, KEY_ID, { iterations: 2_000 })
    expect(stronger.iterations).toBe(2_000)
    const fromStronger = await unwrapMasterKey(stronger, { kind: 'passphrase', passphrase: PASSPHRASE }, KEY_ID)
    expect(Array.from(fromStronger)).toEqual(Array.from(master))

    const recovery = await wrapWithRecoveryKey(master, generateRecoveryKey(), KEY_ID)
    expect(recovery).toMatchObject({ kdf: 'hkdf-sha256', info: expect.any(String) })
    for (const value of [wrap.salt, wrap.iv, recovery.salt, recovery.iv]) {
      expect(value).toMatch(/^[A-Za-z0-9_-]+$/)
    }
  })

  it('derives a stable key proof that is distinct from the data key', async () => {
    const master = generateMasterKey()
    const proof = await deriveKeyProof(master, KEY_ID)
    expect(await deriveKeyProof(master, KEY_ID)).toBe(proof)
    expect(await deriveKeyProof(generateMasterKey(), KEY_ID)).not.toBe(proof)
    expect(proof).toHaveLength(43)
  })
})

describe('server-side information alone', () => {
  it('cannot decrypt posts without the passphrase or the recovery key', async () => {
    const master = generateMasterKey()
    const recoveryKey = generateRecoveryKey()
    const keyring = {
      keyId: KEY_ID,
      passphraseWrap: await wrapWithPassphrase(master, PASSPHRASE, KEY_ID, FAST),
      recoveryWrap: await wrapWithRecoveryKey(master, recoveryKey, KEY_ID),
    }
    const proof = await deriveKeyProof(master, KEY_ID)
    const authHash = toBase64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(proof))))
    const ciphertext = await encryptPost(await deriveDataKey(master, KEY_ID), KEY_ID, '秘匿メモ')
    const serverSide = JSON.stringify({ keyring, authHash, ciphertext })

    // サーバーに渡るものには、マスター鍵・パスフレーズ・復旧キー・平文が無い。
    expect(serverSide).not.toContain(toBase64Url(master))
    expect(serverSide).not.toContain(toBase64Url(recoveryKey))
    expect(serverSide).not.toContain(PASSPHRASE)
    expect(serverSide).not.toContain('秘匿メモ')

    // サーバー側の値（包み・ハッシュ）を鍵の材料にしても、包みも暗号文も解けない。
    for (const material of [keyring.passphraseWrap.wrapped, keyring.recoveryWrap.salt, authHash]) {
      await expect(
        unwrapMasterKey(keyring.passphraseWrap, { kind: 'passphrase', passphrase: material }, KEY_ID),
      ).rejects.toBeInstanceOf(UnwrapError)
      await expect(
        unwrapMasterKey(keyring.recoveryWrap, { kind: 'recovery', recoveryKey: new TextEncoder().encode(material) }, KEY_ID),
      ).rejects.toBeInstanceOf(UnwrapError)
    }
    const guessed = await deriveDataKey(new TextEncoder().encode(authHash).slice(0, 32), KEY_ID)
    await expect(decryptPost(guessed, KEY_ID, ciphertext)).rejects.toBeInstanceOf(UndecryptableError)
  })
})
