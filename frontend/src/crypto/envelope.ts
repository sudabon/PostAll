import { copyBytes, fromBase64Url, randomBytes, toBase64Url, utf8 } from './encoding'

/**
 * 暗号文の形式（design.md D2）: `pe1.<keyId>.<iv>.<ciphertext>`
 *
 * 平文は UTF-8 の本文に 4 バイトの長さを前置し、256 バイト単位まで 0 で詰めてから暗号化する。
 * 暗号文の長さから本文の長さがそのまま分からないようにするため。
 */

export const ENVELOPE_VERSION = 'pe1'
export const PADDING_BLOCK = 256
const IV_BYTES = 12
const LENGTH_PREFIX_BYTES = 4

const ENVELOPE_PATTERN =
  /^([a-z0-9]+)\.([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.([A-Za-z0-9_-]{16})\.([A-Za-z0-9_-]+)$/

/** 改ざん・別の鍵・未知の版のいずれでも、部分的な平文を返さずにこれを投げる。 */
export class UndecryptableError extends Error {
  constructor(reason: string) {
    super(`復号できない暗号文です: ${reason}`)
    this.name = 'UndecryptableError'
  }
}

function aad(keyId: string) {
  return utf8(`postall:post:${ENVELOPE_VERSION}:${keyId}`)
}

export function paddedLength(byteLength: number): number {
  return Math.ceil((LENGTH_PREFIX_BYTES + byteLength) / PADDING_BLOCK) * PADDING_BLOCK
}

function pad(body: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(paddedLength(body.length))
  new DataView(out.buffer).setUint32(0, body.length)
  out.set(body, LENGTH_PREFIX_BYTES)
  return out
}

function unpad(padded: Uint8Array): Uint8Array {
  if (padded.length < LENGTH_PREFIX_BYTES || padded.length % PADDING_BLOCK !== 0) {
    throw new UndecryptableError('詰め物の長さ')
  }
  const length = new DataView(padded.buffer, padded.byteOffset, padded.byteLength).getUint32(0)
  if (length > padded.length - LENGTH_PREFIX_BYTES) throw new UndecryptableError('本文の長さ')
  return padded.subarray(LENGTH_PREFIX_BYTES, LENGTH_PREFIX_BYTES + length)
}

/** 形式が正しければ暗号文に埋め込まれた鍵 ID を返す。版は問わない。 */
export function envelopeKeyId(envelope: string): string | null {
  return ENVELOPE_PATTERN.exec(envelope)?.[2] ?? null
}

export async function encryptPost(dataKey: CryptoKey, keyId: string, plaintext: string): Promise<string> {
  const iv = randomBytes(IV_BYTES)
  const sealed = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: aad(keyId) },
    dataKey,
    pad(utf8(plaintext)),
  )
  return [ENVELOPE_VERSION, keyId, toBase64Url(iv), toBase64Url(new Uint8Array(sealed))].join('.')
}

export async function decryptPost(dataKey: CryptoKey, keyId: string, envelope: string): Promise<string> {
  const match = ENVELOPE_PATTERN.exec(envelope)
  if (!match) throw new UndecryptableError('形式')
  const [, version, envelopeKey, iv, sealed] = match
  if (version !== ENVELOPE_VERSION) throw new UndecryptableError(`未知の版 ${version}`)
  if (envelopeKey !== keyId) throw new UndecryptableError('別の鍵')
  let plain: ArrayBuffer
  try {
    plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromBase64Url(iv!), additionalData: aad(keyId) },
      dataKey,
      fromBase64Url(sealed!),
    )
  } catch {
    throw new UndecryptableError('認証に失敗')
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(copyBytes(unpad(new Uint8Array(plain))))
  } catch (err) {
    if (err instanceof UndecryptableError) throw err
    throw new UndecryptableError('UTF-8')
  }
}
