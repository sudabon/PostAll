import { describe, expect, it } from 'vitest'
import { InvalidRecoveryKeyError, formatRecoveryKey, generateRecoveryKey, parseRecoveryKey } from './recovery-key'

function problemOf(input: string) {
  try {
    parseRecoveryKey(input)
    return null
  } catch (err) {
    expect(err).toBeInstanceOf(InvalidRecoveryKeyError)
    return (err as InvalidRecoveryKeyError).problem
  }
}

describe('recovery key', () => {
  it('generates 32 random bytes and shows them as 14 groups of 4 Crockford Base32 characters', () => {
    const key = generateRecoveryKey()
    expect(key).toHaveLength(32)
    expect(Array.from(generateRecoveryKey())).not.toEqual(Array.from(key))
    const text = formatRecoveryKey(key)
    expect(text).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){13}$/)
  })

  it('round-trips through the displayed form', () => {
    for (let i = 0; i < 20; i += 1) {
      const key = generateRecoveryKey()
      expect(Array.from(parseRecoveryKey(formatRecoveryKey(key)))).toEqual(Array.from(key))
    }
  })

  it('accepts spaces, missing hyphens, lower case, full-width text and look-alike letters', () => {
    const key = generateRecoveryKey()
    const text = formatRecoveryKey(key)
    const variants = [
      text.replace(/-/g, ''),
      text.replace(/-/g, ' ').toLowerCase(),
      `  ${text}\n`,
      text.replace(/0/g, 'O').replace(/1/g, 'l'),
      text.replace(/1/g, 'I'),
      text.normalize('NFKC').replace(/[A-Z0-9]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0xfee0)),
    ]
    for (const variant of variants) {
      expect(Array.from(parseRecoveryKey(variant))).toEqual(Array.from(key))
    }
  })

  it('detects mistyped, missing and invalid characters', () => {
    const text = formatRecoveryKey(generateRecoveryKey())
    const chars = text.replace(/-/g, '').split('')
    for (const position of [0, 17, 30, 55]) {
      const typo = [...chars]
      typo[position] = typo[position] === 'Z' ? 'Y' : 'Z'
      expect(problemOf(typo.join(''))).toBe('checksum')
    }
    const swapped = [...chars]
    const a = swapped.findIndex((c, i) => i > 0 && c !== swapped[i - 1])
    ;[swapped[a - 1], swapped[a]] = [swapped[a]!, swapped[a - 1]!]
    expect(problemOf(swapped.join(''))).toBe('checksum')
    expect(problemOf(chars.slice(1).join(''))).toBe('length')
    expect(problemOf(`${chars.join('')}A`)).toBe('length')
    expect(problemOf(['U', ...chars.slice(1)].join(''))).toBe('character')
  })
})
