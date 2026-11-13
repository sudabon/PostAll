import type { Plugin } from 'vite'

/** CSP の接続先を決めるビルド時の値。 */
export type CspSources = {
  /** VITE_SUPABASE_URL。認証・Realtime・Storage の提供元。未設定なら Supabase を許可しない。 */
  supabaseUrl?: string
  /** VITE_API_BASE_URL。絶対 URL（別オリジン）のときだけ connect-src に加える。 */
  apiBaseUrl?: string
}

function parseAbsoluteUrl(raw: string, name: string): URL {
  try {
    return new URL(raw)
  } catch {
    throw new Error(`[postall-csp] ${name} must be an absolute URL: ${raw}`)
  }
}

function websocketOrigin(url: URL): string {
  return `${url.protocol === 'https:' ? 'wss:' : 'ws:'}//${url.host}`
}

/**
 * 添付の署名付き URL の発行元。Supabase の S3 エンドポイントは
 * `https://<ref>.storage.supabase.co` を使うので、プロジェクト URL から導く。
 */
function supabaseStorageOrigin(url: URL): string | null {
  const match = /^([a-z0-9-]+)\.supabase\.co$/i.exec(url.hostname)
  return match ? `https://${match[1]}.storage.supabase.co` : null
}

export function cspConnectSources({ supabaseUrl, apiBaseUrl }: CspSources): string[] {
  const sources = ["'self'"]
  const add = (source: string) => {
    if (!sources.includes(source)) sources.push(source)
  }
  const supabase = supabaseUrl?.trim()
  if (supabase) {
    const url = parseAbsoluteUrl(supabase, 'VITE_SUPABASE_URL')
    add(url.origin)
    add(websocketOrigin(url))
    const storage = supabaseStorageOrigin(url)
    if (storage) add(storage)
  }
  const api = apiBaseUrl?.trim()
  // 空文字や相対パスは同一オリジンの API なので 'self' で足りる。
  if (api && /^[a-z][a-z0-9+.-]*:/i.test(api)) {
    add(parseAbsoluteUrl(api, 'VITE_API_BASE_URL').origin)
  }
  return sources
}

export function buildCspPolicy(sources: CspSources): string {
  const connect = cspConnectSources(sources)
  // https: は img-src で許可済み。ローカルの Supabase（http）の添付だけ個別に足す。
  const plainHttpOrigins = connect.filter((source) => source.startsWith('http://'))
  const directives: [string, string[]][] = [
    ['default-src', ["'self'"]],
    // 'wasm-unsafe-eval' は Shiki の WASM 正規表現エンジンのため。JS 文字列の評価は許さない。
    ['script-src', ["'self'", "'wasm-unsafe-eval'"]],
    // Mermaid が SVG に出す <style> と、Shiki の style 属性のため。
    ['style-src', ["'self'", "'unsafe-inline'"]],
    ['img-src', ["'self'", 'data:', 'blob:', 'https:', ...plainHttpOrigins]],
    ['font-src', ["'self'", 'data:']],
    ['connect-src', connect],
    ['worker-src', ["'self'"]],
    ['manifest-src', ["'self'"]],
    ['object-src', ["'none'"]],
    ['base-uri', ["'self'"]],
    ['form-action', ["'self'"]],
  ]
  return directives.map(([name, values]) => `${name} ${values.join(' ')}`).join('; ')
}

/**
 * 本番ビルドの index.html の <head> 先頭へ CSP の <meta> を差し込む。
 * 開発サーバ（HMR がインラインスクリプトを使う）には適用しない。
 * frame-ancestors は <meta> では効かないので vercel.json のヘッダーで配る。
 */
export function cspPlugin(): Plugin {
  let policy = ''
  return {
    name: 'postall-csp',
    apply: 'build',
    configResolved(config) {
      policy = buildCspPolicy({
        supabaseUrl: config.env.VITE_SUPABASE_URL,
        apiBaseUrl: config.env.VITE_API_BASE_URL,
      })
    },
    transformIndexHtml: {
      order: 'post',
      handler: () => [
        {
          tag: 'meta',
          attrs: { 'http-equiv': 'Content-Security-Policy', content: policy },
          injectTo: 'head-prepend',
        },
      ],
    },
  }
}
