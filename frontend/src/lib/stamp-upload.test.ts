import { describe, expect, it } from 'vitest'
import {
  ACCEPTED_STAMP_ACCEPT,
  MAX_STAMP_BYTES,
  SHORTCODE_MAX_LENGTH,
  deriveShortcode,
  isValidShortcode,
  validateStampFile,
} from './stamp-upload'

function fileOf(name: string, type: string, size: number): File {
  const file = new File([new Uint8Array(Math.min(size, 1))], name, { type })
  // 大きなバイト列を実際に作らずにサイズだけを差し替える。
  Object.defineProperty(file, 'size', { value: size })
  return file
}

describe('deriveShortcode', () => {
  it('drops the extension and lowercases the rest', () => {
    expect(deriveShortcode('shipit.png')).toBe('shipit')
    expect(deriveShortcode('SmartHR.png')).toBe('smarthr')
    expect(deriveShortcode('celebrate.gif')).toBe('celebrate')
  })

  it('keeps only the characters a shortcode allows', () => {
    expect(deriveShortcode('party parrot.png')).toBe('party-parrot')
    expect(deriveShortcode('snake_case.png')).toBe('snake_case')
    expect(deriveShortcode('already-hyphenated.png')).toBe('already-hyphenated')
    expect(deriveShortcode('dot.separated.name.png')).toBe('dot-separated-name')
  })

  it('collapses runs of replacements into a single hyphen', () => {
    expect(deriveShortcode('too   many    spaces.png')).toBe('too-many-spaces')
    expect(deriveShortcode('mixed !!! symbols.png')).toBe('mixed-symbols')
  })

  it('removes leading characters until the first alphanumeric', () => {
    expect(deriveShortcode('-leading-hyphen.png')).toBe('leading-hyphen')
    expect(deriveShortcode('_leading-underscore.png')).toBe('leading-underscore')
    expect(deriveShortcode('!!!bang.png')).toBe('bang')
  })

  it('trims trailing separators, including ones exposed by truncation', () => {
    expect(deriveShortcode('trailing-.png')).toBe('trailing')
    expect(deriveShortcode('trailing_.png')).toBe('trailing')
    const derived = deriveShortcode(`${'a'.repeat(SHORTCODE_MAX_LENGTH - 1)}- overflow.png`)
    expect(derived).toBe('a'.repeat(SHORTCODE_MAX_LENGTH - 1))
  })

  it('truncates to the maximum length', () => {
    const derived = deriveShortcode(`${'a'.repeat(200)}.png`)
    expect(derived).toHaveLength(SHORTCODE_MAX_LENGTH)
  })

  it('returns an empty string when nothing usable is left', () => {
    expect(deriveShortcode('日本語.png')).toBe('')
    expect(deriveShortcode('---.png')).toBe('')
    expect(deriveShortcode('.gitignore')).toBe('')
    expect(deriveShortcode('')).toBe('')
  })

  it('always derives something a shortcode check accepts, or nothing at all', () => {
    const names = [
      'shipit.png',
      'party parrot.png',
      '-leading.png',
      `${'a'.repeat(200)}.png`,
      'SmartHR.png',
      'trailing-.png',
    ]
    for (const name of names) {
      const derived = deriveShortcode(name)
      expect(derived === '' || isValidShortcode(derived)).toBe(true)
    }
  })
})

describe('isValidShortcode', () => {
  it('accepts what the server accepts', () => {
    for (const shortcode of ['a', '0', 'shipit', 'party-parrot', 'snake_case', 'A1', 'a'.repeat(64)]) {
      expect(isValidShortcode(shortcode)).toBe(true)
    }
  })

  it('rejects what the server rejects', () => {
    for (const shortcode of ['', '-lead', '_lead', 'has space', '日本語', 'dot.separated', 'a'.repeat(65)]) {
      expect(isValidShortcode(shortcode)).toBe(false)
    }
  })
})

describe('validateStampFile', () => {
  it('accepts PNG and GIF within the limit', () => {
    expect(validateStampFile(fileOf('a.png', 'image/png', 1024))).toBeNull()
    expect(validateStampFile(fileOf('a.gif', 'image/gif', MAX_STAMP_BYTES))).toBeNull()
  })

  it('rejects other formats with the accepted ones in the message', () => {
    const reason = validateStampFile(fileOf('a.jpg', 'image/jpeg', 1024))
    expect(reason).toContain('image/png')
    expect(reason).toContain('image/gif')
  })

  it('rejects a file over the limit with the limit in the message', () => {
    const reason = validateStampFile(fileOf('a.png', 'image/png', MAX_STAMP_BYTES + 1))
    expect(reason).toContain('512 KiB')
  })

  it('rejects an empty file', () => {
    expect(validateStampFile(fileOf('a.png', 'image/png', 0))).not.toBeNull()
  })

  it('falls back to the extension only when the browser reports no type', () => {
    expect(validateStampFile(fileOf('a.png', '', 1024))).toBeNull()
    expect(validateStampFile(fileOf('a.gif', '', 1024))).toBeNull()
    expect(validateStampFile(fileOf('a.txt', '', 1024))).not.toBeNull()
    // type が別の形式を名乗っているときは拡張子で救わない。
    expect(validateStampFile(fileOf('a.png', 'text/plain', 1024))).not.toBeNull()
  })

  it('exposes an accept attribute value for the file input', () => {
    expect(ACCEPTED_STAMP_ACCEPT).toBe('image/png,image/gif')
  })
})
