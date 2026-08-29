export function isStandaloneDisplay(): boolean {
  if (window.matchMedia('(display-mode: standalone)').matches) return true
  return Boolean((navigator as Navigator & { standalone?: boolean }).standalone)
}
