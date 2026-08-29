// レンダラ（app://localhost）から API へ到達できることを実アプリで確かめる。
//
// 上流は本番と同じく CORS ヘッダを返さない。したがってレンダラから上流へ直接
// fetch すればブラウザにブロックされる。メインプロセスが app:// の配下で中継して
// はじめて到達できる、という筋を検証する。
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

const health = { status: 'ok', database: 'skipped' }

// レンダラは結果を /v1/__probe__ へ返す。これも API パスなので、中継が働いて
// いなければサーバまで届かない = テストは失敗する。
const page = `<!doctype html>
<meta charset="utf-8">
<title>proxy probe</title>
<script>
  const report = (payload) =>
    fetch('/v1/__probe__', { method: 'POST', body: JSON.stringify(payload) })
  fetch('/health')
    .then(async (res) => report({ ok: true, status: res.status, body: await res.json() }))
    .catch((err) => report({ ok: false, error: String(err) }))
</script>
`

async function main() {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'postall-proxy-'))
  const frontendDir = path.join(tmp, 'frontend')
  await fs.mkdir(frontendDir, { recursive: true })
  await fs.writeFile(path.join(frontendDir, 'index.html'), page)

  let resolveProbe
  const probe = new Promise((resolve) => {
    resolveProbe = resolve
  })

  const upstream = createServer((req, res) => {
    if (req.url === '/health') {
      // 本番と同じ: Access-Control-Allow-Origin を返さない。
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(health))
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
  // Electron が終了しきる前に片付けると、書き込み途中の userData で ENOENT になる。
  const exited = new Promise((resolve) => child.once('exit', resolve))
  child.kill()
  await exited
  upstream.close()
  await fs.rm(tmp, { recursive: true, force: true })

  if (!result.ok) {
    console.error(`FAIL: レンダラから API へ到達できなかった: ${result.error}`)
    process.exit(1)
  }
  if (result.status !== 200) {
    console.error(`FAIL: /health が ${result.status} を返した`)
    process.exit(1)
  }
  if (JSON.stringify(result.body) !== JSON.stringify(health)) {
    console.error(`FAIL: /health の本文が一致しない: ${JSON.stringify(result.body)}`)
    process.exit(1)
  }
  console.log('PASS: app://localhost から /health へ到達できた')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
