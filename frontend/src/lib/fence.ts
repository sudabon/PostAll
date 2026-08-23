export function isInsideUnclosedFence(value: string, cursor: number): boolean {
  const before = value.slice(0, Math.max(0, cursor))
  const fences = before.match(/^```/gm) ?? []
  return fences.length % 2 === 1
}

export function insertCodeFence(value: string, start: number, end: number): { value: string; cursor: number } {
  const before = value.slice(0, start)
  const selected = value.slice(start, end)
  const after = value.slice(end)
  const inner = selected.length > 0 ? selected.replace(/\n?$/, '\n') : '\n'
  const inserted = '```' + inner + '```'
  return { value: before + inserted + after, cursor: before.length + 3 }
}
