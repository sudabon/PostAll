import { describe, expect, it } from 'vitest'
import { applyFormat } from './markdown-format'

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

  it('delegates a code block to the shared fence helper', () => {
    expect(applyFormat('codeBlock', 'ab', 1, 1)).toEqual({ value: 'a```\n```b', selectionStart: 4, selectionEnd: 4 })
  })
})
