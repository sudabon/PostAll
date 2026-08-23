import { describe, expect, it } from 'vitest'
import { buildExcerpt } from './search'

describe('buildExcerpt', () => {
  it('highlights Japanese matches without treating the body as HTML', () => {
    const result = buildExcerpt('長い前置きです。日本語の検索語を安全に表示します。後続です。', '検索語', 10)

    expect(result.parts).toContainEqual({ text: '検索語', match: true })
    expect(result.parts.map((part) => part.text).join('')).toContain('検索語')
  })

  it('matches ASCII without case sensitivity and marks every visible match', () => {
    const result = buildExcerpt('Alpha BETA beta gamma', 'beta', 40)

    expect(result.parts.filter((part) => part.match)).toEqual([
      { text: 'BETA', match: true },
      { text: 'beta', match: true },
    ])
  })

  it('clips around the first match and reports ellipses', () => {
    const result = buildExcerpt(`${'前'.repeat(30)}対象${'後'.repeat(30)}`, '対象', 6)

    expect(result.clippedStart).toBe(true)
    expect(result.clippedEnd).toBe(true)
    expect(result.parts.map((part) => part.text).join('')).toBe('前前前前前前対象後後後後後後')
  })
})
