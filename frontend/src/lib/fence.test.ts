import { describe, expect, it } from 'vitest'
import { expandFenceTrigger, insertCodeFence, isInsideUnclosedFence } from './fence'

describe('fence', () => {
  it('detects an unclosed fence before the cursor', () => {
    expect(isInsideUnclosedFence('```js\nconst x = 1', 16)).toBe(true)
    expect(isInsideUnclosedFence('```js\nconst x = 1\n```\n', 22)).toBe(false)
    expect(isInsideUnclosedFence('hello', 5)).toBe(false)
  })

  it('inserts a fence and places the cursor on the body line', () => {
    const next = insertCodeFence('ab', 1, 1)
    expect(next.value).toBe('a```\n\n```b')
    // 開始フェンスの直後（言語指定の位置）ではなく、囲まれた空行に置く
    expect(next.cursor).toBe(5)
  })

  it('wraps a selection on the body line instead of the info string', () => {
    const next = insertCodeFence('xconst x = 1y', 1, 12)
    expect(next.value).toBe('x```\nconst x = 1\n```y')
    expect(next.cursor).toBe(5)
    // 開始フェンスの行に選択テキストが残っていない（言語指定として解釈されない）
    expect(next.value.split('\n')[0]).toBe('x```')
    expect(next.value.slice(next.cursor, next.cursor + 11)).toBe('const x = 1')
  })

  it('keeps a single body line when the selection already ends with a newline', () => {
    const next = insertCodeFence('a\n', 0, 2)
    expect(next.value).toBe('```\na\n```')
    expect(next.cursor).toBe(4)
  })
})

describe('expandFenceTrigger', () => {
  it('expands three backticks typed at the start of the text', () => {
    expect(expandFenceTrigger('``', '```', 3)).toEqual({ value: '```\n\n```', cursor: 4 })
  })

  it('expands three backticks typed at the start of a line', () => {
    expect(expandFenceTrigger('a\n``', 'a\n```', 5)).toEqual({ value: 'a\n```\n\n```', cursor: 6 })
  })

  it('keeps the trailing text when it expands', () => {
    expect(expandFenceTrigger('``\nx', '```\nx', 3)).toEqual({ value: '```\n\n```\nx', cursor: 4 })
  })

  it('does not expand a paste that adds more than one character', () => {
    expect(expandFenceTrigger('', '```', 3)).toBeNull()
    expect(expandFenceTrigger('`', '```', 3)).toBeNull()
  })

  it('does not expand when the added character is not a backtick', () => {
    expect(expandFenceTrigger('``a', '``ab', 4)).toBeNull()
  })

  it('does not expand when the three characters before the caret are not backticks', () => {
    expect(expandFenceTrigger('ab', 'ab`', 3)).toBeNull()
    expect(expandFenceTrigger('`', '``', 2)).toBeNull()
  })

  it('does not expand in the middle of a line', () => {
    expect(expandFenceTrigger('x``', 'x```', 4)).toBeNull()
  })

  it('does not expand inside an unclosed fence', () => {
    expect(expandFenceTrigger('```js\nfoo\n``', '```js\nfoo\n```', 13)).toBeNull()
  })
})
