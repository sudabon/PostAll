import { copyBytes, fromBase64Url, randomBytes, toBase64Url, utf8 } from './encoding'

/**
 * 鍵の階層（design.md D1）。
 *
 *   パスフレーズ ─PBKDF2-SHA256─▶ 包み鍵 ─┐
 *   復旧キー   ─HKDF-SHA256 ─▶ 包み鍵 ─┴─(AES-GCM で包む)─▶ マスター鍵（32 バイト）
 *                                                   ├─HKDF ".../enc"  ─▶ 暗号鍵（取り出せない AES-256-GCM）
 *                                                   └─HKDF ".../auth" ─▶ 所持の証明（32 バイト）
 *
 * サーバーへ送ってよいのは、包み（KeyWrap）と所持の証明だけ。
 */

export const PBKDF2_ITERATIONS = 600_000
export const MIN_PASSPHRASE_LENGTH = 12
export const MASTER_KEY_BYTES = 32
const SALT_BYTES = 16
const IV_BYTES = 12
const RECOVERY_INFO = 'postall:wrap:recovery:v1'
const DATA_KEY_INFO = 'postall:pe1:enc'
const KEY_PROOF_INFO = 'postall:pe1:auth'

export type PassphraseWrap = {
  kdf: 'pbkdf2-sha256'
  iterations: number
  salt: string
  iv: string
  wrapped: string
}

export type RecoveryWrap = {
  kdf: 'hkdf-sha256'
  salt: string
  info: string
  iv: string
  wrapped: string
}

export type KeyWrap = PassphraseWrap | RecoveryWrap

export type UnlockSecret =
  | { kind: 'passphrase'; passphrase: string }
  | { kind: 'recovery'; recoveryKey: Uint8Array }

/** 誤ったパスフレーズ・復旧キー、または壊れた包み。GCM の認証タグで判定する。 */
export class UnwrapError extends Error {
  constructor() {
    super('鍵を解けませんでした')
    this.name = 'UnwrapError'
  }
}

/** 端末ごとの入力方式の違い（濁点の合成など）で別の鍵にならないよう、NFC にそろえる。 */
export function normalizePassphrase(passphrase: string): string {
  return passphrase.normalize('NFC')
}

export function passphraseLength(passphrase: string): number {
  return Array.from(normalizePassphrase(passphrase)).length
}

export function generateMasterKey(): Uint8Array<ArrayBuffer> {
  return randomBytes(MASTER_KEY_BYTES)
}

function wrapAad(keyId: string, kdf: KeyWrap['kdf']) {
  return utf8(`postall:wrap:${kdf}:${keyId}`)
}

async function passphraseWrappingKey(passphrase: string, salt: Uint8Array<ArrayBuffer>, iterations: number) {
  const base = await crypto.subtle.importKey('raw', utf8(normalizePassphrase(passphrase)), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

async function recoveryWrappingKey(recoveryKey: Uint8Array, salt: Uint8Array<ArrayBuffer>, info: string) {
  const base = await crypto.subtle.importKey('raw', copyBytes(recoveryKey), 'HKDF', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt, info: utf8(info) },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

async function seal(wrappingKey: CryptoKey, master: Uint8Array, aad: Uint8Array<ArrayBuffer>) {
  const iv = randomBytes(IV_BYTES)
  const wrapped = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad }, wrappingKey, copyBytes(master))
  return { iv: toBase64Url(iv), wrapped: toBase64Url(new Uint8Array(wrapped)) }
}

export async function wrapWithPassphrase(
  master: Uint8Array,
  passphrase: string,
  keyId: string,
  options: { iterations?: number } = {},
): Promise<PassphraseWrap> {
  const iterations = options.iterations ?? PBKDF2_ITERATIONS
  const salt = randomBytes(SALT_BYTES)
  const key = await passphraseWrappingKey(passphrase, salt, iterations)
  const sealed = await seal(key, master, wrapAad(keyId, 'pbkdf2-sha256'))
  return { kdf: 'pbkdf2-sha256', iterations, salt: toBase64Url(salt), ...sealed }
}

export async function wrapWithRecoveryKey(
  master: Uint8Array,
  recoveryKey: Uint8Array,
  keyId: string,
): Promise<RecoveryWrap> {
  const salt = randomBytes(SALT_BYTES)
  const key = await recoveryWrappingKey(recoveryKey, salt, RECOVERY_INFO)
  const sealed = await seal(key, master, wrapAad(keyId, 'hkdf-sha256'))
  return { kdf: 'hkdf-sha256', salt: toBase64Url(salt), info: RECOVERY_INFO, ...sealed }
}

/**
 * 包みを解いてマスター鍵を返す。呼び出し側は使い終わったら fill(0) で消すこと。
 * 包みの種類と秘密の種類が合わない場合も、誤った秘密と同じく UnwrapError にする。
 */
export async function unwrapMasterKey(
  wrap: KeyWrap,
  secret: UnlockSecret,
  keyId: string,
): Promise<Uint8Array<ArrayBuffer>> {
  try {
    const salt = fromBase64Url(wrap.salt)
    let key: CryptoKey
    if (wrap.kdf === 'pbkdf2-sha256' && secret.kind === 'passphrase') {
      key = await passphraseWrappingKey(secret.passphrase, salt, wrap.iterations)
    } else if (wrap.kdf === 'hkdf-sha256' && secret.kind === 'recovery') {
      key = await recoveryWrappingKey(secret.recoveryKey, salt, wrap.info)
    } else {
      throw new UnwrapError()
    }
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromBase64Url(wrap.iv), additionalData: wrapAad(keyId, wrap.kdf) },
      key,
      fromBase64Url(wrap.wrapped),
    )
    const master = new Uint8Array(plain)
    if (master.length !== MASTER_KEY_BYTES) throw new UnwrapError()
    return master
  } catch {
    throw new UnwrapError()
  }
}

async function masterHkdf(master: Uint8Array) {
  return crypto.subtle.importKey('raw', copyBytes(master), 'HKDF', false, ['deriveKey', 'deriveBits'])
}

/** ポストの暗号化と復号に使う鍵。取り出せない（non-extractable）CryptoKey にする。 */
export async function deriveDataKey(master: Uint8Array, keyId: string): Promise<CryptoKey> {
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: utf8(keyId), info: utf8(DATA_KEY_INFO) },
    await masterHkdf(master),
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

/** 鍵束を書き換える要求に付ける所持の証明（base64url）。ここから暗号鍵は導けない。 */
export async function deriveKeyProof(master: Uint8Array, keyId: string): Promise<string> {
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: utf8(keyId), info: utf8(KEY_PROOF_INFO) },
    await masterHkdf(master),
    256,
  )
  return toBase64Url(new Uint8Array(bits))
}
