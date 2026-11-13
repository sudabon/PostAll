// @harden-sensitive-data-protection @TP-007
// 本番ビルドの frontend/dist（fixture: electron:built-dist）を Electron で読み込み、
// ブラウザと同じ CSP の <meta> が効くことを実アプリで確かめる。
//
// 確かめること:
//   - アプリシェルに CSP の <meta> が 1 つだけあり、script-src が自オリジン（app://localhost）に限られる
//   - 文書に挿入したインラインスクリプトは実行されず、script-src の違反として記録される
//   - アプリシェル（サインイン画面）は通常どおり表示される
//
// 観測には、CSP が許す同一オリジンの外部スクリプト（/__e2e__/csp-probe.js）を使う。
// ビルド済みの index.html は、この 1 行を </body> の直前に足す以外は変えない。
// 事前に `cd frontend && npm run build` が要る。
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { existsSync } from 'node:fs'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const TEST_NAME = 'Electron でも本番ビルドの CSP が効く @harden-sensitive-data-protection @TP-007'
const require = createRequire(import.meta.url)
const electronBinary = require('electron')
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.join(__dirname, '..')
const builtDist = process.env.POSTALL_BUILT_FRONTEND_DIR || path.join(projectRoot, '../frontend/dist')
const timeoutMs = 60_000

const probeScript = `
const violations = []
document.addEventListener('securitypolicyviolation', (event) => {
  violations.push({ effectiveDirective: event.effectiveDirective, blockedURI: event.blockedURI })
})
const report = (payload) => fetch('/v1/__probe__', { method: 'POST', body: JSON.stringify(payload) })
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
;(async () => {
  try {
    const metas = [...document.querySelectorAll('meta[http-equiv="Content-Security-Policy"]')]
    const inline = document.createElement('script')
    inline.textContent = 'window.__inlineScriptRan = true'
    document.body.append(inline)
    let shell = false
    for (let i = 0; i < 100 && !shell; i += 1) {
      shell = Boolean(document.querySelector('[data-testid="sign-in-button"], [data-testid="channel-tree"]'))
      if (!shell) await wait(100)
    }
    await wait(200)
    await report({
      ok: true,
      origin: location.origin,
      policies: metas.map((m) => m.getAttribute('content')),
      inlineScriptRan: window.__inlineScriptRan === true,
      violations,
      shell,
      heading: document.querySelector('h1')?.textContent ?? null,
    })
  } catch (err) {
    await report({ ok: false, error: String(err) })
  }
})()
`

function fail(message) {
  console.error(`FAIL: ${TEST_NAME}: ${message}`)
  process.exit(1)
}

async function main() {
  const builtIndex = path.join(builtDist, 'index.html')
  if (!existsSync(builtIndex)) {
    fail(`${builtIndex} が無い。先に cd frontend && npm run build を実行する`)
  }
  const original = await fs.readFile(builtIndex, 'utf8')
  if (!original.includes('http-equiv="Content-Security-Policy"')) {
    fail(`${builtIndex} に CSP の <meta> が無い。CSP プラグイン入りでビルドし直す`)
  }

  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'postall-csp-'))
  const frontendDir = path.join(tmp, 'frontend')
  await fs.cp(builtDist, frontendDir, { recursive: true })
  await fs.mkdir(path.join(frontendDir, '__e2e__'), { recursive: true })
  await fs.writeFile(path.join(frontendDir, '__e2e__', 'csp-probe.js'), probeScript)
  await fs.writeFile(
    path.join(frontendDir, 'index.html'),
    original.replace('</body>', '<script src="/__e2e__/csp-probe.js"></script>\n</body>'),
  )

  let resolveProbe
  const probe = new Promise((resolve) => {
    resolveProbe = resolve
  })
  const upstream = createServer((req, res) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      if (req.url === '/v1/__probe__') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end('{}')
        resolveProbe(JSON.parse(Buffer.concat(chunks).toString('utf8')))
        return
      }
      if (req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ status: 'ok', database: 'skipped' }))
        return
      }
      res.writeHead(401, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ code: 'unauthorized', message: 'unauthorized' }))
    })
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

  // 起動直後に落ちる（Linux の sandbox の設定不備など）と、後から登録した exit は二度と来ない。
  // 応答を待つ前に登録し、落ちたら直ちに失敗させる。
  let childExit = null
  const exited = new Promise((resolve) => {
    child.once('exit', (code, signal) => {
      childExit = { code, signal }
      resolveProbe({ ok: false, error: `Electron がレンダラの応答前に終了した (code=${code}, signal=${signal})` })
      resolve()
    })
  })
  const timer = setTimeout(() => {
    resolveProbe({ ok: false, error: `${timeoutMs}ms 以内にレンダラから応答がなかった` })
  }, timeoutMs)

  const result = await probe
  clearTimeout(timer)
  if (!childExit) child.kill()
  await exited
  upstream.close()
  await fs.rm(tmp, { recursive: true, force: true })

  if (!result.ok) fail(result.error)
  if (result.origin !== 'app://localhost') fail(`想定外のオリジン: ${result.origin}`)
  if (result.policies.length !== 1) fail(`CSP の <meta> が ${result.policies.length} 個ある`)
  const scriptSrc = result.policies[0].split(';').map((d) => d.trim()).find((d) => d.startsWith('script-src '))
  if (scriptSrc !== "script-src 'self' 'wasm-unsafe-eval'") fail(`script-src が想定と違う: ${scriptSrc}`)
  if (result.inlineScriptRan) fail('挿入したインラインスクリプトが実行された')
  if (!result.violations.some((v) => v.effectiveDirective.startsWith('script-src'))) {
    fail(`script-src の違反が記録されていない: ${JSON.stringify(result.violations)}`)
  }
  const unexpected = result.violations.filter((v) => !(v.effectiveDirective.startsWith('script-src') && v.blockedURI === 'inline'))
  if (unexpected.length > 0) fail(`挿入したスクリプト以外の違反がある: ${JSON.stringify(unexpected)}`)
  if (!result.shell) fail(`アプリシェルが表示されない（見出し: ${result.heading}）`)
  console.log(`PASS: ${TEST_NAME}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
