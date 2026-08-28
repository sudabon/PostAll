import { useEffect, useState, type RefObject } from 'react'

export function useScrollEdge<T extends HTMLElement>(
  rootRef: RefObject<T | null>,
  sentinelRef: RefObject<HTMLElement | null>,
) {
  const [isContentUnderChrome, setContentUnderChrome] = useState(false)

  useEffect(() => {
    const root = rootRef.current
    const sentinel = sentinelRef.current
    if (!root || !sentinel || typeof IntersectionObserver === 'undefined') return

    const observer = new IntersectionObserver(([entry]) => {
      setContentUnderChrome(!entry.isIntersecting)
    }, { root, threshold: 1 })
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [rootRef, sentinelRef])

  return isContentUnderChrome
}
