// @add-client-side-post-encryption @TP-033
// Electron で「この端末で記憶する」を選んだときの鍵の保管（fixture: electron:encryption-key-store）。
//
// 確かめること:
//   - safeStorage が使えて、electron adapter の canPersist() が true になる
//   - 記憶した鍵が、同じ user-data-dir で再起動した後も取り出せ、前回の暗号文を復号できる
//   - 取り出した暗号鍵は取り出せない（non-extractable）CryptoKey である
//   - user-data-dir のどのファイルにも、マスター鍵の値が平文（raw・base64・base64url・hex）で現れない
//
// 観測用のページは、レンダラの electron adapter（frontend/src/platform/electron.ts の
// createElectronKeyStore）と暗号モジュールを、フロントエンドの esbuild で 1 つに束ねたもの。
// アプリ本体は読み込まず、window.postallPlatform（preload）経由で secret:* を操作する。
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { randomBytes, randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const TEST_NAME = 'Electron で記憶した鍵が再起動後も取り出せ、保存ファイルに平文で現れない @add-client-side-post-encryption @TP-033'
const require = createRequire(import.meta.url)
const electronBinary = require('electron')
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.join(__dirname, '..')
const frontendRoot = path.join(projectRoot, '../frontend')
const timeoutMs = 60_000
const PLAINTEXT = 'TP-033 再起動をまたいで読む秘密'

function fail(message) {
  console.error(`FAIL: ${TEST_NAME}: ${message}`)
  process.exit(1)
}

async function buildProbe(outFile) {
  let esbuild
  try {
    esbuild = createRequire(path.join(frontendRoot, 'package.json'))('esbuild')
  } catch {
    fail('frontend の esbuild を読めない。先に cd frontend && npm ci を実行する')
  }
  const src = (file) => JSON.stringify(path.join(frontendRoot, 'src', file))
  await esbuild.build({
    stdin: {
      contents: `
import { createElectronKeyStore } from ${src('platform/electron.ts')}
import { decryptPost, encryptPost } from ${src('crypto/envelope.ts')}
import { fromBase64Url } from ${src('crypto/encoding.ts')}

const report = (payload) => fetch('/v1/__probe__/report', { method: 'POST', body: JSON.stringify(payload) })
;(async () => {
  try {
    const config = await (await fetch('/v1/__probe__/config')).json()
    const store = createElectronKeyStore(window.postallPlatform)
    const canPersist = await store.canPersist()
    if (config.phase === 'save') {
      if (canPersist) await store.save(config.keyId, fromBase64Url(config.masterKey))
      const loaded = await store.load()
      await report({
        ok: true,
        canPersist,
        keyId: loaded?.keyId ?? null,
        extractable: loaded?.dataKey.extractable ?? null,
        ciphertext: loaded ? await encryptPost(loaded.dataKey, config.keyId, config.plaintext) : null,
      })
      return
    }
    const loaded = await store.load()
    await report({
      ok: true,
      canPersist,
      keyId: loaded?.keyId ?? null,
      extractable: loaded?.dataKey.extractable ?? null,
      plaintext: loaded ? await decryptPost(loaded.dataKey, config.keyId, config.ciphertext) : null,
    })
  } catch (err) {
    await report({ ok: false, error: String(err?.stack ?? err) })
  }
})()
`,
      resolveDir: frontendRoot,
      loader: 'ts',
    },
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'es2022',
    tsconfig: path.join(frontendRoot, 'tsconfig.app.json'),
    outfile: outFile,
    logLevel: 'silent',
  })
}

/** 1 回起動して、観測用のページの報告を受け取ってから終了させる。 */
async function runOnce({ frontendDir, userData, config }) {
  let resolveProbe
  const probe = new Promise((resolve) => {
    resolveProbe = resolve
  })
  const upstream = createServer((req, res) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      if (req.url === '/v1/__probe__/config') {
        // 設定にはテスト用のマスター鍵が入る。HTTP キャッシュに残すと、下の走査で誤検知する。
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
        res.end(JSON.stringify(config))
        return
      }
      if (req.url === '/v1/__probe__/report') {
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

  // Linux（CI）では、デスクトップ環境が無いと Chromium は平文の保管（basic）を選び、safeStorage が
  // 使えないことになる。CI が起動する Secret Service（gnome-keyring）を使うよう指定する。
  const passwordStore = process.platform === 'linux' ? ['--password-store=gnome-libsecret'] : []
  const child = spawn(electronBinary, ['.', `--user-data-dir=${userData}`, ...passwordStore], {
    cwd: projectRoot,
    env: {
      ...process.env,
      POSTALL_FRONTEND_DIR: frontendDir,
      POSTALL_API_BASE_URL: `http://127.0.0.1:${port}`,
    },
    stdio: 'inherit',
  })
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
  return result
}

async function listFiles(dir) {
  const out = []
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...(await listFiles(full)))
    else if (entry.isFile()) out.push(full)
  }
  return out
}

async function main() {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'postall-key-store-'))
  const frontendDir = path.join(tmp, 'frontend')
  const userData = path.join(tmp, 'userdata')
  try {
    await fs.mkdir(path.join(frontendDir, '__e2e__'), { recursive: true })
    await buildProbe(path.join(frontendDir, '__e2e__', 'key-store-probe.js'))
    await fs.writeFile(
      path.join(frontendDir, 'index.html'),
      '<!doctype html><meta charset="utf-8"><title>key store probe</title><script src="/__e2e__/key-store-probe.js"></script>\n',
    )

    const master = randomBytes(32)
    const keyId = randomUUID()
    const masterKey = master.toString('base64url')

    const saved = await runOnce({ frontendDir, userData, config: { phase: 'save', keyId, masterKey, plaintext: PLAINTEXT } })
    if (!saved.ok) fail(saved.error)
    if (saved.canPersist !== true) {
      fail('safeStorage が使えず、canPersist() が false だった（Linux では Secret Service が要る）')
    }
    if (saved.keyId !== keyId) fail(`保存直後に鍵を読み戻せない: ${JSON.stringify(saved)}`)
    if (saved.extractable !== false) fail('読み戻した暗号鍵が取り出せる（extractable）')
    if (typeof saved.ciphertext !== 'string' || !saved.ciphertext.startsWith(`pe1.${keyId}.`)) {
      fail(`暗号文を作れない: ${JSON.stringify(saved)}`)
    }

    const restarted = await runOnce({ frontendDir, userData, config: { phase: 'load', keyId, ciphertext: saved.ciphertext } })
    if (!restarted.ok) fail(restarted.error)
    if (restarted.keyId !== keyId) fail(`再起動後に鍵を取り出せない: ${JSON.stringify(restarted)}`)
    if (restarted.extractable !== false) fail('再起動後の暗号鍵が取り出せる（extractable）')
    if (restarted.plaintext !== PLAINTEXT) fail(`再起動後に前回の暗号文を復号できない: ${JSON.stringify(restarted)}`)

    const secretsFile = path.join(userData, 'postall-secrets.bin')
    const stored = await fs.readFile(secretsFile).catch(() => null)
    if (!stored) fail(`${secretsFile} が無い`)
    if (stored.includes(Buffer.from('encryption.masterKey'))) fail('秘密情報のファイルが平文で書かれている')
    const needles = [
      ['raw', master],
      ['base64', Buffer.from(master.toString('base64'))],
      ['base64url', Buffer.from(masterKey)],
      ['hex', Buffer.from(master.toString('hex'))],
    ]
    for (const file of await listFiles(userData)) {
      const content = await fs.readFile(file)
      for (const [kind, needle] of needles) {
        if (content.includes(needle)) fail(`${path.relative(userData, file)} にマスター鍵の値（${kind}）が平文で現れた`)
      }
    }
  } finally {
    await fs.rm(tmp, { recursive: true, force: true })
  }
  console.log(`PASS: ${TEST_NAME}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
