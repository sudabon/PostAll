import { useSyncExternalStore } from 'react'

/**
 * 暗号化チャネルの下書き。端末のストレージには書かず、このマップにだけ置く。
 * ロックとサインアウトでまとめて捨てる。
 */
const drafts = new Map<string, string>()
let epoch = 0
const listeners = new Set<() => void>()

function emit() {
  epoch += 1
  for (const listener of listeners) listener()
}

export function readMemoryDraft(key: string): string {
  return drafts.get(key) ?? ''
}

export function writeMemoryDraft(key: string, value: string) {
  if (value) drafts.set(key, value)
  else drafts.delete(key)
}

export function clearMemoryDrafts() {
  if (drafts.size === 0 && epoch === 0) return
  drafts.clear()
  emit()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useMemoryDraftEpoch(): number {
  return useSyncExternalStore(subscribe, () => epoch, () => epoch)
}
