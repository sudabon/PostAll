export const WIDE_VIEWPORT_QUERY = '(min-width: 768px)'

export function isWideViewport(): boolean {
  return window.matchMedia(WIDE_VIEWPORT_QUERY).matches
}

export function keyboardBottomInset(
  visualViewport: { height: number; offsetTop: number },
  innerHeight: number,
): number {
  return Math.max(0, innerHeight - visualViewport.height - visualViewport.offsetTop)
}
