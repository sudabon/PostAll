// メインプロセスから外部へ送るリクエストヘッダを、ブラウザと同じ規則にそろえる。
//
// レンダラの XHR / fetch は「呼び出し側が指定できないヘッダ」を黙って捨て、
// 値はネットワークスタックが付け直す。ところがメインプロセスの net.fetch は
// 捨てずに拒否し、net::ERR_INVALID_ARGUMENT になる。署名付き PUT の headers には
// Content-Length が入るため、そのまま渡すとアップロードが必ず失敗する。
// ここで同じヘッダを落として、どちらの経路でもストレージが受け取るヘッダを
// 同じにする。Content-Length は本文から付け直されるので SigV4 の署名は一致する。
//
// 一覧は Fetch 標準の forbidden request-header name に合わせている。
const FORBIDDEN_HEADERS = new Set([
  'accept-charset',
  'accept-encoding',
  'access-control-request-headers',
  'access-control-request-method',
  'connection',
  'content-length',
  'cookie',
  'cookie2',
  'date',
  'dnt',
  'expect',
  'host',
  'keep-alive',
  'origin',
  'referer',
  'set-cookie',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'via',
])

const FORBIDDEN_PREFIXES = ['proxy-', 'sec-']

function isForbidden(name) {
  const lower = name.toLowerCase()
  return FORBIDDEN_HEADERS.has(lower) || FORBIDDEN_PREFIXES.some((p) => lower.startsWith(p))
}

export function sanitizeOutboundHeaders(headers) {
  const out = {}
  for (const [name, value] of Object.entries(headers ?? {})) {
    if (isForbidden(name)) continue
    out[name] = value
  }
  return out
}
