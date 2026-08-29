export const WIDE_VIEWPORT_QUERY = '(min-width: 768px)'
export const TOUCH_QUERY = '(hover: none) and (pointer: coarse)'

export function isTouchDevice(): boolean {
  if (typeof window === 'undefined') return false
  return window.matchMedia?.(TOUCH_QUERY).matches ?? false
}

export function isWideViewport(): boolean {
  return window.matchMedia(WIDE_VIEWPORT_QUERY).matches
}

export function keyboardBottomInset(
  visualViewport: { height: number; offsetTop: number },
  innerHeight: number,
): number {
  return Math.max(0, innerHeight - visualViewport.height - visualViewport.offsetTop)
}
