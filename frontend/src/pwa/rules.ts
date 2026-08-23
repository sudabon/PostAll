/** Service Worker が API・添付をキャッシュしないための判定。vite 設定とテストで共有する。 */
export function isAppShellPath(pathname: string): boolean {
  if (pathname.startsWith('/v1/')) return false
  if (pathname === '/health' || pathname.startsWith('/health?')) return false
  if (pathname.includes('/attachments')) return false
  return true
}

export function shouldCacheUrl(url: URL): boolean {
  return isAppShellPath(url.pathname)
}
