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

const page = `<!doctype html>
<meta charset="utf-8">
<title>narrow window probe</title>
<script>
  const report = (payload) =>
    fetch('/v1/__probe__', { method: 'POST', body: JSON.stringify(payload) })
  const waitFrame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()))
  ;(async () => {
    try {
      const bridge = window.postallPlatform
      await bridge.invoke('secret:set', 'auth.tokens', '{"refreshToken":"keep"}')
      const stored = await bridge.invoke('secret:get', 'auth.tokens')
      const bounds = await bridge.invoke('window:getState')
      await bridge.invoke('window:setState', { ...bounds, width: 1280, height: 800 })
      await waitFrame()
      const wide = {
        innerWidth: window.innerWidth,
        matchMedia: window.matchMedia('(min-width: 768px)').matches,
      }
      await bridge.invoke('window:setState', { ...bounds, width: 390, height: 844 })
      await waitFrame()
      const narrow = {
        innerWidth: window.innerWidth,
        matchMedia: window.matchMedia('(min-width: 768px)').matches,
      }
      await bridge.invoke('secret:delete', 'auth.tokens')
      const cleared = await bridge.invoke('secret:get', 'auth.tokens')
      await report({ ok: true, stored, cleared, wide, narrow })
    } catch (err) {
      await report({ ok: false, error: String(err) })
    }
  })()
</script>
`

async function main() {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'postall-narrow-'))
  const frontendDir = path.join(tmp, 'frontend')
  await fs.mkdir(frontendDir, { recursive: true })
  await fs.writeFile(path.join(frontendDir, 'index.html'), page)

  let resolveProbe
  const probe = new Promise((resolve) => {
    resolveProbe = resolve
  })

  const upstream = createServer((req, res) => {
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
    console.error(`FAIL: ${result.error}`)
    process.exit(1)
  }
  if (result.stored !== '{"refreshToken":"keep"}') {
    console.error(`FAIL: secret:set/get が壊れている: ${result.stored}`)
    process.exit(1)
  }
  if (result.cleared != null) {
    console.error(`FAIL: secret:delete が壊れている: ${result.cleared}`)
    process.exit(1)
  }
  if (!result.wide.matchMedia || result.wide.innerWidth < 768) {
    console.error(`FAIL: 広幅ウィンドウで matchMedia が一致しない: ${JSON.stringify(result.wide)}`)
    process.exit(1)
  }
  if (result.narrow.matchMedia || result.narrow.innerWidth >= 768) {
    console.error(`FAIL: 狭幅ウィンドウへ縮小できていない: ${JSON.stringify(result.narrow)}`)
    process.exit(1)
  }
  console.log('PASS: 広幅/狭幅の切替と secret 保管が動いた')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
