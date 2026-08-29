import { useSyncExternalStore } from 'react'
import { WIDE_VIEWPORT_QUERY } from '@/lib/viewport'

function subscribe(onStoreChange: () => void) {
  const mq = window.matchMedia(WIDE_VIEWPORT_QUERY)
  mq.addEventListener('change', onStoreChange)
  return () => mq.removeEventListener('change', onStoreChange)
}

function getSnapshot() {
  return window.matchMedia(WIDE_VIEWPORT_QUERY).matches
}

export function useWideViewport() {
  return useSyncExternalStore(subscribe, getSnapshot, () => true)
}
