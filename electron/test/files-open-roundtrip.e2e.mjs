// files:open で読んだバイト列がレンダラで壊れず、そのまま files:put できることを確かめる。
// 本番の添付はこの往復（メイン → レンダラ → メイン）を必ず通る。
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { createHash } from 'node:crypto'
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
const xlsxType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const payload = Buffer.from('xlsx-probe-body')
const checksum = createHash('sha256').update(payload).digest('hex')

const page = `<!doctype html>
<meta charset="utf-8">
<title>files open roundtrip</title>
<script>
  const report = (payload) =>
    fetch('/v1/__probe__', { method: 'POST', body: JSON.stringify(payload) })
  const inspect = (value) => ({
    ctor: value == null ? String(value) : value.constructor?.name ?? typeof value,
    byteLength: value?.byteLength ?? null,
    tag: Object.prototype.toString.call(value),
    keys: value && typeof value === 'object' && !ArrayBuffer.isView(value) && !(value instanceof ArrayBuffer)
      ? Object.keys(value).slice(0, 8)
      : null,
  })
  ;(async () => {
    try {
      const picked = await window.postallPlatform.invoke('files:open', { multiple: false })
      const file = picked[0]
      const info = {
        name: file?.name,
        type: file?.type,
        data: inspect(file?.data),
      }
      const digest = await crypto.subtle.digest('SHA-256', file.data)
      const checksum = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
      const start = await fetch('/v1/attachments/uploads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileName: file.name,
          contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          sizeBytes: file.data.byteLength,
          checksum,
        }),
      }).then((r) => r.json())
      await window.postallPlatform.invoke('files:put', start.uploadUrl, file.data, start.headers)
      await report({ ok: true, info, checksum })
    } catch (err) {
      await report({ ok: false, error: String(err), stack: err?.stack })
    }
  })()
</script>
`

async function main() {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'postall-open-roundtrip-'))
  const frontendDir = path.join(tmp, 'frontend')
  await fs.mkdir(frontendDir, { recursive: true })
  await fs.writeFile(path.join(frontendDir, 'index.html'), page)
  const xlsxPath = path.join(tmp, 'report.xlsx')
  await fs.writeFile(xlsxPath, payload)

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
          headers: { 'Content-Type': xlsxType, 'Content-Length': String(payload.length) },
        }),
      )
      return
    }
    if (req.url === '/storage/put' && req.method === 'PUT') {
      const chunks = []
      req.on('data', (c) => chunks.push(c))
      req.on('end', () => {
        const body = Buffer.concat(chunks)
        receivedPuts.push({
          body,
          contentType: req.headers['content-type'],
          contentLength: req.headers['content-length'],
        })
        if (req.headers['content-length'] !== String(payload.length)) {
          res.writeHead(403)
          res.end('content-length mismatch')
          return
        }
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
      POSTALL_TEST_OPEN_FILES: xlsxPath,
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

  console.log('ROUNDTRIP_RESULT', JSON.stringify(result, null, 2))
  console.log('RECEIVED_PUTS', receivedPuts.length, receivedPuts[0]?.contentLength, receivedPuts[0]?.body?.equals(payload))

  if (!result.ok) {
    console.error(`FAIL: ${result.error}`)
    process.exit(1)
  }
  if (result.info?.data?.byteLength !== payload.length) {
    console.error(`FAIL: renderer byteLength=${result.info?.data?.byteLength}`)
    process.exit(1)
  }
  if (result.checksum !== checksum) {
    console.error(`FAIL: checksum=${result.checksum} want=${checksum}`)
    process.exit(1)
  }
  if (receivedPuts.length !== 1 || !receivedPuts[0].body.equals(payload)) {
    console.error('FAIL: PUT body mismatch')
    process.exit(1)
  }
  console.log('PASS: files:open のバイト列をレンダラ経由で PUT できた')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
