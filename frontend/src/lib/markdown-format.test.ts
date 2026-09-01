import { describe, expect, it } from 'vitest'
import { applyFormat, indentLines } from './markdown-format'

describe('applyFormat', () => {
  it('wraps the selection and keeps it selected', () => {
    expect(applyFormat('bold', 'ab', 0, 2)).toEqual({ value: '**ab**', selectionStart: 2, selectionEnd: 4 })
    expect(applyFormat('italic', 'ab', 0, 2).value).toBe('*ab*')
    expect(applyFormat('underline', 'ab', 0, 2).value).toBe('<u>ab</u>')
    expect(applyFormat('strike', 'ab', 0, 2).value).toBe('~~ab~~')
    expect(applyFormat('code', 'ab', 0, 2).value).toBe('`ab`')
  })

  it('places the cursor between the markers with no selection', () => {
    expect(applyFormat('bold', 'ab', 1, 1)).toEqual({ value: 'a****b', selectionStart: 3, selectionEnd: 3 })
    expect(applyFormat('underline', '', 0, 0)).toEqual({ value: '<u></u>', selectionStart: 3, selectionEnd: 3 })
  })

  it('unwraps when the markers are inside the selection', () => {
    expect(applyFormat('bold', 'x**ab**y', 1, 7)).toEqual({ value: 'xaby', selectionStart: 1, selectionEnd: 3 })
    expect(applyFormat('underline', '<u>ab</u>', 0, 9).value).toBe('ab')
  })

  it('unwraps when the markers surround the selection', () => {
    expect(applyFormat('bold', '**ab**', 2, 4)).toEqual({ value: 'ab', selectionStart: 0, selectionEnd: 2 })
    expect(applyFormat('strike', 'x~~ab~~y', 3, 5).value).toBe('xaby')
  })

  it('builds a link and selects the url placeholder', () => {
    const withText = applyFormat('link', 'ab', 0, 2)
    expect(withText.value).toBe('[ab](url)')
    expect(withText.value.slice(withText.selectionStart, withText.selectionEnd)).toBe('url')
  })

  it('builds an empty link and puts the cursor in the label', () => {
    expect(applyFormat('link', '', 0, 0)).toEqual({ value: '[](url)', selectionStart: 1, selectionEnd: 1 })
  })

  it('prefixes every line the selection touches', () => {
    expect(applyFormat('bulletList', 'a\nb', 0, 3).value).toBe('- a\n- b')
    expect(applyFormat('quote', 'a\nb', 0, 3).value).toBe('> a\n> b')
    expect(applyFormat('orderedList', 'a\nb\nc', 0, 5).value).toBe('1. a\n2. b\n3. c')
  })

  it('prefixes only the current line when nothing is selected', () => {
    expect(applyFormat('bulletList', 'a\nb', 2, 2).value).toBe('a\n- b')
  })

  it('removes the prefix when every touched line already has it', () => {
    expect(applyFormat('bulletList', '- a\n- b', 0, 7).value).toBe('a\nb')
    expect(applyFormat('quote', '> a', 0, 3).value).toBe('a')
    expect(applyFormat('orderedList', '1. a\n2. b', 0, 9).value).toBe('a\nb')
  })

  it('replaces an existing list or quote marker when switching kinds', () => {
    expect(applyFormat('orderedList', '- a\n- b', 0, 7).value).toBe('1. a\n2. b')
    expect(applyFormat('bulletList', '> a', 0, 3).value).toBe('- a')
  })

  it('keeps the indent and swaps only the marker on an indented line', () => {
    expect(applyFormat('bulletList', '    1. a', 0, 8).value).toBe('    - a')
    expect(applyFormat('orderedList', '    - a', 0, 7).value).toBe('    1. a')
    expect(applyFormat('quote', '    - a', 0, 7).value).toBe('    > a')
    expect(applyFormat('bulletList', '    > a', 0, 7).value).toBe('    - a')
  })

  it('keeps the indent when it removes a marker the line already has', () => {
    expect(applyFormat('bulletList', '    - a', 0, 7).value).toBe('    a')
    expect(applyFormat('orderedList', '    1. a\n    2. b', 0, 17).value).toBe('    a\n    b')
  })

  it('adds a marker to an indented plain line without dropping the indent', () => {
    expect(applyFormat('bulletList', '    a', 0, 5).value).toBe('    - a')
  })

  it('delegates a code block to the shared fence helper', () => {
    // ツールバー経由でも insertCodeFence と同じく本文の行にカーソルが来る
    expect(applyFormat('codeBlock', 'ab', 1, 1)).toEqual({ value: 'a```\n\n```b', selectionStart: 5, selectionEnd: 5 })
    expect(applyFormat('codeBlock', 'xconst x = 1y', 1, 12).value).toBe('x```\nconst x = 1\n```y')
  })
})

describe('indentLines', () => {
  it('indents a single bullet line by four spaces', () => {
    expect(indentLines('- a', 1, 1)).toEqual({ value: '    - a', selectionStart: 5, selectionEnd: 5 })
  })

  it('indents every line the selection touches and keeps the selection', () => {
    const next = indentLines('- a\n- b', 0, 7)
    expect(next).toEqual({ value: '    - a\n    - b', selectionStart: 0, selectionEnd: 15 })
    expect(next!.value.slice(next!.selectionStart, next!.selectionEnd)).toBe('    - a\n    - b')
  })

  it('indents a numbered list by four spaces so it nests', () => {
    // design.md の実測表: 数字箇条書きは +2 で別リストに分裂し、4 が全記法で成立する最小値
    expect(indentLines('1. a', 0, 0)!.value).toBe('    1. a')
    expect(indentLines('10. a', 0, 0)!.value).toBe('    10. a')
    expect(indentLines('* a', 0, 0)!.value).toBe('    * a')
    expect(indentLines('+ a', 0, 0)!.value).toBe('    + a')
  })

  it('adds a second level on an already indented line', () => {
    expect(indentLines('    - a', 0, 0)!.value).toBe('        - a')
  })

  it('returns null when a line is not a list item', () => {
    expect(indentLines('plain', 0, 0)).toBeNull()
    expect(indentLines('- a\nplain', 0, 9)).toBeNull()
    expect(indentLines('', 0, 0)).toBeNull()
  })

  it('returns null for a quote so Tab keeps moving focus', () => {
    // 引用の入れ子はマーカーの重ね（`> > `）で表すため、空白の増減では扱えない。
    // anyLineMarker を流用すると引用まで字下げされてしまう。
    expect(indentLines('> a', 0, 0)).toBeNull()
    expect(indentLines('> a', 0, 0, { outdent: true })).toBeNull()
    expect(indentLines('    > a', 0, 0, { outdent: true })).toBeNull()
    expect(indentLines('- a\n> b', 0, 7)).toBeNull()
  })

  it('outdents a single indented line', () => {
    expect(indentLines('    - a', 5, 5, { outdent: true })).toEqual({
      value: '- a',
      selectionStart: 1,
      selectionEnd: 1,
    })
  })

  it('outdents every line the selection touches and keeps the selection', () => {
    const next = indentLines('    - a\n    - b', 0, 15, { outdent: true })
    expect(next).toEqual({ value: '- a\n- b', selectionStart: 0, selectionEnd: 7 })
  })

  it('outdents only the indented lines of a mixed selection', () => {
    expect(indentLines('- a\n    - b', 0, 11, { outdent: true })).toEqual({
      value: '- a\n- b',
      selectionStart: 0,
      selectionEnd: 7,
    })
  })

  it('removes what is there when a line is indented by less than one step', () => {
    expect(indentLines('  - a', 0, 5, { outdent: true })!.value).toBe('- a')
  })

  it('returns null when no line can be outdented', () => {
    expect(indentLines('- a', 0, 3, { outdent: true })).toBeNull()
    expect(indentLines('- a\n- b', 0, 7, { outdent: true })).toBeNull()
    expect(indentLines('plain', 0, 5, { outdent: true })).toBeNull()
  })

  it('restores the exact body when an indent is followed by an outdent', () => {
    const roundTrip = (value: string, start: number, end: number) => {
      const indented = indentLines(value, start, end)!
      return indentLines(indented.value, indented.selectionStart, indented.selectionEnd, { outdent: true })!
    }
    expect(roundTrip('- a', 3, 3)).toEqual({ value: '- a', selectionStart: 3, selectionEnd: 3 })
    expect(roundTrip('- a\n- b', 0, 7)).toEqual({ value: '- a\n- b', selectionStart: 0, selectionEnd: 7 })
    expect(roundTrip('1. a\n2. b', 2, 9)).toEqual({ value: '1. a\n2. b', selectionStart: 2, selectionEnd: 9 })
    expect(roundTrip('    - a\n    - b', 2, 10)).toEqual({
      value: '    - a\n    - b',
      selectionStart: 2,
      selectionEnd: 10,
    })
  })
})
