// レンダラから app:// 経由で送ったバイナリが、上流へそのまま届くことを確かめる。
// スタンプ登録は multipart の実体を /v1/emojis へ送る。本文を text として読むと
// 非 UTF-8 バイトが壊れ、画像として受理されない。
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
<title>binary proxy probe</title>
<script>
  const report = (payload) =>
    fetch('/v1/__probe__', { method: 'POST', body: JSON.stringify(payload) })
  ;(async () => {
    try {
      const body = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a])
      const echoed = await fetch('/v1/__echo__', {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body,
      })
      const bytes = new Uint8Array(await echoed.arrayBuffer())
      await report({
        ok: echoed.ok && bytes.length === body.length && bytes.every((b, i) => b === body[i]),
        status: echoed.status,
        length: bytes.length,
      })
    } catch (err) {
      await report({ ok: false, error: String(err) })
    }
  })()
</script>
`

async function main() {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'postall-binary-proxy-'))
  const frontendDir = path.join(tmp, 'frontend')
  await fs.mkdir(frontendDir, { recursive: true })
  await fs.writeFile(path.join(frontendDir, 'index.html'), page)

  let resolveProbe
  const probe = new Promise((resolve) => {
    resolveProbe = resolve
  })
  let received = null

  const upstream = createServer((req, res) => {
    if (req.url === '/v1/__echo__' && req.method === 'POST') {
      const chunks = []
      req.on('data', (c) => chunks.push(c))
      req.on('end', () => {
        received = Buffer.concat(chunks)
        res.writeHead(200, { 'Content-Type': 'application/octet-stream' })
        res.end(received)
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

  if (!received || !received.equals(payload)) {
    console.error(
      `FAIL: 上流が受け取った本文が壊れている: received=${received ? received.toString('hex') : 'null'}`,
    )
    process.exit(1)
  }
  if (!result.ok) {
    console.error(`FAIL: レンダラが受け取ったエコーが一致しない: ${JSON.stringify(result)}`)
    process.exit(1)
  }
  console.log('PASS: app:// 中継がバイナリを保存した')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
