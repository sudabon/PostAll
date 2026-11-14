import { describe, expect, it } from 'vitest'
import { fromBase64Url, toBase64Url } from './encoding'
import { deriveDataKey, generateMasterKey } from './keys'
import { PADDING_BLOCK, UndecryptableError, decryptPost, encryptPost, envelopeKeyId, paddedLength } from './envelope'

const KEY_ID = '0b6c5c1e-8d2a-4f7e-9c3b-1a2b3c4d5e6f'
const OTHER_KEY_ID = '22222222-2222-4222-8222-222222222222'
const GCM_TAG_BYTES = 16

async function dataKey(keyId = KEY_ID) {
  return deriveDataKey(generateMasterKey(), keyId)
}

function sealedBytes(envelope: string) {
  return fromBase64Url(envelope.split('.')[3]!).length
}

describe('envelope', () => {
  it('round-trips Markdown, code and Japanese text', async () => {
    const key = await dataKey()
    const body = '# 見出し\n\n```ts\nconst x = 1\n```\n\n```mermaid\ngraph TD\n  A-->B\n```\n絵文字 🔐'
    const envelope = await encryptPost(key, KEY_ID, body)
    expect(envelope).toMatch(/^pe1\.0b6c5c1e-8d2a-4f7e-9c3b-1a2b3c4d5e6f\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]+$/)
    expect(envelope).not.toContain('見出し')
    expect(await decryptPost(key, KEY_ID, envelope)).toBe(body)
    expect(await decryptPost(key, KEY_ID, await encryptPost(key, KEY_ID, ''))).toBe('')
  })

  it('uses a fresh iv for every encryption of the same text', async () => {
    const key = await dataKey()
    const first = await encryptPost(key, KEY_ID, 'same')
    const second = await encryptPost(key, KEY_ID, 'same')
    expect(first.split('.')[2]).not.toBe(second.split('.')[2])
    expect(first).not.toBe(second)
  })

  it('detects a single changed byte in the ciphertext or the iv', async () => {
    const key = await dataKey()
    const envelope = await encryptPost(key, KEY_ID, '改ざんの検出')
    const [version, keyId, iv, sealed] = envelope.split('.') as [string, string, string, string]
    const flip = (text: string, index: number) => {
      const bytes = fromBase64Url(text)
      bytes[index] = bytes[index]! ^ 0x01
      return toBase64Url(bytes)
    }
    for (const tampered of [
      [version, keyId, iv, flip(sealed, 0)].join('.'),
      [version, keyId, iv, flip(sealed, fromBase64Url(sealed).length - 1)].join('.'),
      [version, keyId, flip(iv, 0), sealed].join('.'),
    ]) {
      await expect(decryptPost(key, KEY_ID, tampered)).rejects.toBeInstanceOf(UndecryptableError)
    }
  })

  it('refuses ciphertext of another key, even when the key id is rewritten', async () => {
    const mine = await dataKey()
    const theirs = await dataKey(OTHER_KEY_ID)
    const foreign = await encryptPost(theirs, OTHER_KEY_ID, '別の鍵')
    expect(envelopeKeyId(foreign)).toBe(OTHER_KEY_ID)
    await expect(decryptPost(mine, KEY_ID, foreign)).rejects.toBeInstanceOf(UndecryptableError)
    await expect(decryptPost(mine, KEY_ID, foreign.replace(OTHER_KEY_ID, KEY_ID))).rejects.toBeInstanceOf(UndecryptableError)
  })

  it('pads the plaintext to multiples of 256 bytes', async () => {
    const key = await dataKey()
    const lengths = new Map<number, number>()
    for (const size of [0, 1, 200, 252, 253, 508, 509, 1_000]) {
      const envelope = await encryptPost(key, KEY_ID, 'a'.repeat(size))
      const plainBytes = sealedBytes(envelope) - GCM_TAG_BYTES
      expect(plainBytes % PADDING_BLOCK).toBe(0)
      expect(plainBytes).toBe(paddedLength(size))
      lengths.set(size, plainBytes)
    }
    expect(lengths.get(0)).toBe(256)
    expect(lengths.get(1)).toBe(256)
    expect(lengths.get(252)).toBe(256)
    expect(lengths.get(253)).toBe(512)
    expect(lengths.get(1_000)).toBe(1_024)
  })

  it('rejects unknown versions and malformed envelopes', async () => {
    const key = await dataKey()
    const envelope = await encryptPost(key, KEY_ID, 'version')
    await expect(decryptPost(key, KEY_ID, envelope.replace(/^pe1\./, 'pe2.'))).rejects.toThrow(/未知の版/)
    for (const bad of ['', 'pe1', `pe1.${KEY_ID}.short.AAAA`, `${envelope}.extra`, envelope.replace(/\.[^.]+$/, '.a+b')]) {
      await expect(decryptPost(key, KEY_ID, bad)).rejects.toBeInstanceOf(UndecryptableError)
    }
  })
})
