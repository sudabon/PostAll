import { insertCodeFence } from './fence'

export type FormatAction =
  | 'bold'
  | 'italic'
  | 'underline'
  | 'strike'
  | 'link'
  | 'orderedList'
  | 'bulletList'
  | 'quote'
  | 'code'
  | 'codeBlock'

export type FormatResult = { value: string; selectionStart: number; selectionEnd: number }

const wrappers: Partial<Record<FormatAction, [string, string]>> = {
  bold: ['**', '**'],
  italic: ['*', '*'],
  underline: ['<u>', '</u>'],
  strike: ['~~', '~~'],
  code: ['`', '`'],
}

const linePrefixes: Partial<Record<FormatAction, string>> = {
  bulletList: '- ',
  quote: '> ',
}

/** 行頭の箇条書き・番号付き・引用マーカー。書式を切り替えるときに剥がす。 */
const anyLineMarker = /^(?:[-*+] |\d+\. |> )/

export function applyFormat(action: FormatAction, value: string, start: number, end: number): FormatResult {
  const wrapper = wrappers[action]
  if (wrapper) return applyWrap(value, start, end, wrapper[0], wrapper[1])
  if (action === 'link') return applyLink(value, start, end)
  if (action === 'codeBlock') {
    const next = insertCodeFence(value, start, end)
    return { value: next.value, selectionStart: next.cursor, selectionEnd: next.cursor }
  }
  return applyLinePrefix(action, value, start, end)
}

function applyWrap(value: string, start: number, end: number, open: string, close: string): FormatResult {
  const selected = value.slice(start, end)
  if (selected.length >= open.length + close.length && selected.startsWith(open) && selected.endsWith(close)) {
    const inner = selected.slice(open.length, selected.length - close.length)
    return {
      value: value.slice(0, start) + inner + value.slice(end),
      selectionStart: start,
      selectionEnd: start + inner.length,
    }
  }
  if (value.slice(start - open.length, start) === open && value.slice(end, end + close.length) === close) {
    const cursor = start - open.length
    return {
      value: value.slice(0, cursor) + selected + value.slice(end + close.length),
      selectionStart: cursor,
      selectionEnd: cursor + selected.length,
    }
  }
  const cursor = start + open.length
  return {
    value: value.slice(0, start) + open + selected + close + value.slice(end),
    selectionStart: cursor,
    selectionEnd: cursor + selected.length,
  }
}

function applyLink(value: string, start: number, end: number): FormatResult {
  const selected = value.slice(start, end)
  const before = value.slice(0, start)
  const after = value.slice(end)
  if (!selected) {
    return { value: `${before}[](url)${after}`, selectionStart: start + 1, selectionEnd: start + 1 }
  }
  const urlStart = start + selected.length + 3
  return {
    value: `${before}[${selected}](url)${after}`,
    selectionStart: urlStart,
    selectionEnd: urlStart + 3,
  }
}

function applyLinePrefix(action: FormatAction, value: string, start: number, end: number): FormatResult {
  const lineStart = value.lastIndexOf('\n', start - 1) + 1
  const newline = value.indexOf('\n', end)
  const lineEnd = newline === -1 ? value.length : newline
  const lines = value.slice(lineStart, lineEnd).split('\n')
  const prefix = linePrefixes[action]
  const marked = (line: string) => (prefix ? line.startsWith(prefix) : /^\d+\. /.test(line))
  const remove = lines.every(marked)
  const next = lines
    .map((line, i) => {
      const bare = line.replace(anyLineMarker, '')
      if (remove) return bare
      return prefix ? `${prefix}${bare}` : `${i + 1}. ${bare}`
    })
    .join('\n')
  return {
    value: value.slice(0, lineStart) + next + value.slice(lineEnd),
    selectionStart: lineStart,
    selectionEnd: lineStart + next.length,
  }
}
