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

/**
 * 行頭の箇条書き・番号付き・引用マーカー。書式を切り替えるときに剥がす。
 * 先頭の字下げを捕獲するのは、Tab で作った入れ子を保ったままマーカーだけを
 * 付け替えるため（`replace(anyLineMarker, '$1')` で字下げだけが残る）。
 * 引用（`> `）を含むのは、書式操作では引用も剥がす対象だから。空白の増減で
 * 入れ子にできる行だけを選ぶ `indentableMarker` とは用途が違うので流用しない。
 */
const anyLineMarker = /^([ \t]*)(?:[-*+] |\d+\. |> )?/

/**
 * 空白の増減で入れ子にできる箇条書き。引用（`> `）は入れ子をマーカーの重ね
 * （`> > `）で表すため含めない。マーカーを剥がす対象を表す `anyLineMarker` とは
 * 用途が違うので、共通化すると引用まで字下げされてしまう。
 */
const indentableMarker = /^ *(?:[-*+] |\d+\. )/

/** 入れ子の 1 段階。全ての箇条書き記法で入れ子として解釈される最小の字下げ量。 */
const INDENT = '    '

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
  const { lineStart, lineEnd, lines } = touchedLines(value, start, end)
  const prefix = linePrefixes[action]
  // 判定も付け替えも字下げの内側で行う。インデントされた箇条書きを見落とすと
  // マーカーが剥がれずに `-     - foo` のように二重に付く。
  const marked = (line: string) => {
    const body = line.replace(/^[ \t]*/, '')
    return prefix ? body.startsWith(prefix) : /^\d+\. /.test(body)
  }
  const remove = lines.every(marked)
  const next = lines
    .map((line, i) => {
      const indent = anyLineMarker.exec(line)?.[1] ?? ''
      const bare = line.replace(anyLineMarker, '')
      if (remove) return indent + bare
      return indent + (prefix ? `${prefix}${bare}` : `${i + 1}. ${bare}`)
    })
    .join('\n')
  return {
    value: value.slice(0, lineStart) + next + value.slice(lineEnd),
    selectionStart: lineStart,
    selectionEnd: lineStart + next.length,
  }
}

/** 選択範囲がかかる行を、その範囲の先頭・末尾の位置とともに取り出す。 */
function touchedLines(value: string, start: number, end: number) {
  const lineStart = value.lastIndexOf('\n', start - 1) + 1
  const newline = value.indexOf('\n', end)
  const lineEnd = newline === -1 ? value.length : newline
  return { lineStart, lineEnd, lines: value.slice(lineStart, lineEnd).split('\n') }
}

/**
 * 選択範囲がかかる箇条書きの行を 1 段階インデントする。`outdent` ならその逆操作。
 * 何もしない場合は `null` を返す。呼び出し側は Tab を奪わずフォーカス移動に任せる。
 */
export function indentLines(
  value: string,
  start: number,
  end: number,
  { outdent = false }: { outdent?: boolean } = {},
): FormatResult | null {
  const { lineStart, lineEnd, lines } = touchedLines(value, start, end)
  // インデントは対象行が全て箇条書きのときだけ行う。文章の行に空白が入ると
  // 意図しない字下げ（4 つでコードブロック）になり、黙って本文が壊れる。
  if (!lines.every((line) => indentableMarker.test(line))) return null
  // 解除は 1 行でも戻せるときだけ行う。入れ子の親子をまとめて選んだときに
  // 全行そろっていることを求めると、いつまでも解除できなくなる。
  const removed = lines.map((line) => (outdent ? (/^ {1,4}/.exec(line)?.[0].length ?? 0) : 0))
  if (outdent && removed.every((n) => n === 0)) return null

  const deltas = removed.map((n) => (outdent ? -n : INDENT.length))
  const next = lines.map((line, i) => (outdent ? line.slice(removed[i]) : INDENT + line))
  const offsets: number[] = []
  for (let i = 0, at = lineStart; i < lines.length; i++) {
    offsets.push(at)
    at += lines[i].length + 1
  }
  // 選択範囲を元の文字の上に保つ。行頭に置かれた位置は動かさず、字下げの内側に
  // 入っていた位置は解除後の行頭で止める。
  const move = (pos: number) => {
    let shift = 0
    for (let i = 0; i < lines.length; i++) {
      const from = offsets[i]
      if (pos > from + lines[i].length) {
        shift += deltas[i]
        continue
      }
      if (pos === from) break
      return Math.max(from + shift, pos + shift + deltas[i])
    }
    return pos + shift
  }
  return {
    value: value.slice(0, lineStart) + next.join('\n') + value.slice(lineEnd),
    selectionStart: move(start),
    selectionEnd: move(end),
  }
}
