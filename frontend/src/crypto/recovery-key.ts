import { randomBytes } from './encoding'

/**
 * 復旧キー: 32 バイトの乱数に CRC-24（OpenPGP）の 3 バイトを足し、Crockford Base32 の
 * 56 文字を 4 文字ずつ区切って示す。CRC は写し間違いを、解錠を試す前に見つけるためのもの。
 */

export const RECOVERY_KEY_BYTES = 32
const CHECKSUM_BYTES = 3
const ENCODED_CHARS = ((RECOVERY_KEY_BYTES + CHECKSUM_BYTES) * 8) / 5
const GROUP = 4
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

export type RecoveryKeyProblem = 'length' | 'character' | 'checksum'

export class InvalidRecoveryKeyError extends Error {
  readonly problem: RecoveryKeyProblem

  constructor(problem: RecoveryKeyProblem) {
    super(`復旧キーの形式が正しくありません（${problem}）`)
    this.name = 'InvalidRecoveryKeyError'
    this.problem = problem
  }
}

export function generateRecoveryKey(): Uint8Array<ArrayBuffer> {
  return randomBytes(RECOVERY_KEY_BYTES)
}

function crc24(bytes: Uint8Array): number {
  let crc = 0xb704ce
  for (const byte of bytes) {
    crc ^= byte << 16
    for (let i = 0; i < 8; i += 1) {
      crc <<= 1
      if (crc & 0x1000000) crc ^= 0x1864cfb
    }
  }
  return crc & 0xffffff
}

function withChecksum(key: Uint8Array): Uint8Array {
  const crc = crc24(key)
  const out = new Uint8Array(RECOVERY_KEY_BYTES + CHECKSUM_BYTES)
  out.set(key)
  out[RECOVERY_KEY_BYTES] = (crc >> 16) & 0xff
  out[RECOVERY_KEY_BYTES + 1] = (crc >> 8) & 0xff
  out[RECOVERY_KEY_BYTES + 2] = crc & 0xff
  return out
}

export function formatRecoveryKey(key: Uint8Array): string {
  if (key.length !== RECOVERY_KEY_BYTES) throw new RangeError('recovery key must be 32 bytes')
  let bits = 0
  let value = 0
  let text = ''
  for (const byte of withChecksum(key)) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      bits -= 5
      text += ALPHABET[(value >> bits) & 31]
    }
  }
  return text.match(new RegExp(`.{1,${GROUP}}`, 'g'))!.join('-')
}

/** 空白・ハイフン・大小文字・全角の違いと、Crockford の読み替え（O→0, I/L→1）を許して解釈する。 */
export function parseRecoveryKey(input: string): Uint8Array<ArrayBuffer> {
  const normalized = input
    .normalize('NFKC')
    .toUpperCase()
    .replace(/[\s\-‐‑–—ー]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1')
  if (normalized.length !== ENCODED_CHARS) throw new InvalidRecoveryKeyError('length')
  const bytes = new Uint8Array(RECOVERY_KEY_BYTES + CHECKSUM_BYTES)
  let bits = 0
  let value = 0
  let index = 0
  for (const char of normalized) {
    const digit = ALPHABET.indexOf(char)
    if (digit < 0) throw new InvalidRecoveryKeyError('character')
    value = ((value << 5) | digit) & 0xffff
    bits += 5
    if (bits >= 8) {
      bits -= 8
      bytes[index] = (value >> bits) & 0xff
      index += 1
    }
  }
  const key = bytes.slice(0, RECOVERY_KEY_BYTES)
  const expected = crc24(key)
  const actual = (bytes[RECOVERY_KEY_BYTES]! << 16) | (bytes[RECOVERY_KEY_BYTES + 1]! << 8) | bytes[RECOVERY_KEY_BYTES + 2]!
  if (expected !== actual) throw new InvalidRecoveryKeyError('checksum')
  return key
}
