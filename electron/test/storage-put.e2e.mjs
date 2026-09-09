// レンダラからオブジェクトストレージへ PUT できることを実アプリで確かめる。
//
// 署名付き URL は app:// の外（別オリジン）にあり、ストレージは CORS ヘッダを
// 返さない。レンダラの XHR / fetch ではブラウザにブロックされるため、メイン
// プロセスの net.fetch 経由（files:put）で送る。
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const electronBinary = require('electron')
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.join(__dirname, '..')
const timeoutMs = 60_000
const payload = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a])

const page = `<!doctype html>
<meta charset="utf-8">
<title>storage put probe</title>
<script>
  const report = (payload) =>
    fetch('/v1/__probe__', { method: 'POST', body: JSON.stringify(payload) })
  ;(async () => {
    try {
      const start = await fetch('/v1/attachments/uploads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileName: 'a.png', contentType: 'image/png', sizeBytes: 6, checksum: 'x' }),
      }).then((r) => r.json())
      const body = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a])
      const data = body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength)
      // 本番と同じく API が返したヘッダをそのまま渡す。ここを直書きすると
      // Content-Length のような「呼び出し側が指定できないヘッダ」が抜け落ちて、
      // 実際には失敗する組み合わせをテストが素通りさせてしまう。
      await window.postallPlatform.invoke('files:put', start.uploadUrl, data, start.headers)
      await report({ ok: true })
    } catch (err) {
      await report({ ok: false, error: String(err) })
    }
  })()
</script>
`

async function main() {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'postall-storage-put-'))
  const frontendDir = path.join(tmp, 'frontend')
  await fs.mkdir(frontendDir, { recursive: true })
  await fs.writeFile(path.join(frontendDir, 'index.html'), page)

  let resolveProbe
  const probe = new Promise((resolve) => {
    resolveProbe = resolve
  })
  const receivedPuts = []

  const upstream = createServer((req, res) => {
    if (req.url === '/v1/attachments/uploads' && req.method === 'POST') {
      res.writeHead(201, { 'Content-Type': 'application/json' })
      res.end(
        JSON.stringify({
          id: 'att-1',
          uploadUrl: `http://127.0.0.1:${upstream.address().port}/storage/put`,
          // 署名付き PUT の実装（backend/internal/blob/s3.go）が返すヘッダと同じ形。
          headers: { 'Content-Type': 'image/png', 'Content-Length': String(payload.length) },
        }),
      )
      return
    }
    if (req.url === '/storage/put' && req.method === 'PUT') {
      const chunks = []
      req.on('data', (c) => chunks.push(c))
      req.on('end', () => {
        receivedPuts.push({
          body: Buffer.concat(chunks),
          contentType: req.headers['content-type'],
          contentLength: req.headers['content-length'],
        })
        res.writeHead(200)
        res.end()
      })
      return
    }
    if (req.url === '/v1/__probe__') {
      const chunks = []
      req.on('data', (c) => chunks.push(c))
      req.on('end', () => {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end('{}')
        resolveProbe(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      })
      return
    }
    res.writeHead(404)
    res.end()
  })

  await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve))
  const { port } = upstream.address()

  const child = spawn(electronBinary, ['.', `--user-data-dir=${path.join(tmp, 'userdata')}`], {
    cwd: projectRoot,
    env: {
      ...process.env,
      POSTALL_FRONTEND_DIR: frontendDir,
      POSTALL_API_BASE_URL: `http://127.0.0.1:${port}`,
    },
    stdio: 'inherit',
  })

  const timer = setTimeout(() => {
    resolveProbe({ ok: false, error: `${timeoutMs}ms 以内にレンダラから応答がなかった` })
  }, timeoutMs)

  const result = await probe
  clearTimeout(timer)
  const exited = new Promise((resolve) => child.once('exit', resolve))
  child.kill()
  await exited
  upstream.close()
  await fs.rm(tmp, { recursive: true, force: true })

  if (!result.ok) {
    console.error(`FAIL: files:put が失敗した: ${result.error}`)
    process.exit(1)
  }
  if (receivedPuts.length !== 1) {
    console.error(`FAIL: ストレージへの PUT が ${receivedPuts.length} 回`)
    process.exit(1)
  }
  if (!receivedPuts[0].body.equals(payload)) {
    console.error(`FAIL: PUT 本文が一致しない: ${receivedPuts[0].body.toString('hex')}`)
    process.exit(1)
  }
  if (receivedPuts[0].contentType !== 'image/png') {
    console.error(`FAIL: Content-Type=${receivedPuts[0].contentType}`)
    process.exit(1)
  }
  // 署名付き URL は content-length も署名対象にする。呼び出し側では指定できないが、
  // ネットワークスタックが本文から付け直すので、届いた値が一致することを確かめる。
  if (receivedPuts[0].contentLength !== String(payload.length)) {
    console.error(`FAIL: Content-Length=${receivedPuts[0].contentLength}`)
    process.exit(1)
  }
  console.log('PASS: レンダラから files:put でストレージへ到達できた')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
