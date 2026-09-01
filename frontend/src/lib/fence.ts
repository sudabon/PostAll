export function isInsideUnclosedFence(value: string, cursor: number): boolean {
  const before = value.slice(0, Math.max(0, cursor))
  const fences = before.match(/^```/gm) ?? []
  return fences.length % 2 === 1
}

export function insertCodeFence(value: string, start: number, end: number): { value: string; cursor: number } {
  const before = value.slice(0, start)
  const selected = value.slice(start, end)
  const after = value.slice(end)
  // 選択の有無によらずフェンスに囲まれた本文の行を作り、そこにカーソルを置く。
  // 開始フェンスの直後は言語指定の位置なので、選択テキストもカーソルも置かない。
  const body = selected.replace(/\n$/, '')
  return { value: before + '```\n' + body + '\n```' + after, cursor: before.length + 4 }
}

/**
 * 行頭で 1 文字ずつ打たれたバッククォート 3 つを、コードブロックの雛形へ展開する。
 * 展開しないときは `null` を返す。判定を値の差分で行うのは、予測変換や音声入力の
 * ようにキーイベントが当てにならない入力経路でも同じ結果にするため。
 */
export function expandFenceTrigger(
  prev: string,
  next: string,
  caret: number,
): { value: string; cursor: number } | null {
  // 1 文字だけ増えた入力に限る。貼り付けと IME の変換確定はまとめて入るので外れる。
  if (next.length !== prev.length + 1) return null
  if (next.slice(caret - 3, caret) !== '```') return null
  // フェンスは行頭でしか開かない。isInsideUnclosedFence の数え方（/^```/gm）にも揃える。
  if (caret - 3 !== 0 && next[caret - 4] !== '\n') return null
  // 未閉のコードブロックの中では展開しない。閉じフェンスを手で打つ場合も含む。
  if (isInsideUnclosedFence(prev, caret - 1)) return null
  const stripped = next.slice(0, caret - 3) + next.slice(caret)
  return insertCodeFence(stripped, caret - 3, caret - 3)
}
