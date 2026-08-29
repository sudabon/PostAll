import { app, BrowserWindow, Menu, Notification, dialog, ipcMain, protocol, net, safeStorage, shell } from 'electron'
import { existsSync, statSync } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
])

const __dirname = path.dirname(fileURLToPath(import.meta.url))

let mainWindow = null
const persist = new Map()
const secrets = new Map()

function frontendDir() {
  // テストから配信元を差し替えるための口。
  if (process.env.POSTALL_FRONTEND_DIR) return process.env.POSTALL_FRONTEND_DIR
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'frontend')
  }
  return path.join(__dirname, '../frontend/dist')
}

function resolveFrontendFile(pathname) {
  const dist = frontendDir()
  const rel = decodeURIComponent(pathname.split('?')[0] || '/')
  const candidate = path.normalize(path.join(dist, rel === '/' ? 'index.html' : rel))
  if (!candidate.startsWith(dist)) return path.join(dist, 'index.html')
  if (existsSync(candidate) && statSync(candidate).isFile()) return candidate
  return path.join(dist, 'index.html')
}

// API のオリジン。既定値は Flutter 側（mobile/lib/state/settings.dart）と揃える。
const apiOrigin = (process.env.POSTALL_API_BASE_URL || 'https://memo.sudabon.com').replace(/\/+$/, '')

function isApiPath(pathname) {
  return pathname === '/health' || pathname === '/ready' || pathname.startsWith('/v1/')
}

// レンダラのオリジンは app://localhost なので、API を直接呼ぶとクロスオリジンになる。
// API は CORS ヘッダを返さない（ブラウザ版は同一オリジン配信、iOS は CORS の適用外）
// ため、レンダラからの直接呼び出しは必ずブロックされる。メインプロセスの net.fetch は
// CORS の制約を受けないので、ここで中継してレンダラには同一オリジンとして見せる。
async function proxyToApi(request, url) {
  const headers = new Headers(request.headers)
  for (const name of ['origin', 'referer', 'host', 'connection']) headers.delete(name)
  const hasBody = request.method !== 'GET' && request.method !== 'HEAD'
  try {
    return await net.fetch(`${apiOrigin}${url.pathname}${url.search}`, {
      method: request.method,
      headers,
      body: hasBody ? await request.text() : undefined,
    })
  } catch (err) {
    // 上流へ届かないときは API と同じエラー形で返し、レンダラ側の判定に載せる。
    return new Response(JSON.stringify({ code: 'upstream_unreachable', message: String(err) }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}

function storePath() {
  return path.join(app.getPath('userData'), 'postall-store.json')
}

function secretsPath() {
  return path.join(app.getPath('userData'), 'postall-secrets.bin')
}

async function loadStores() {
  try {
    const raw = JSON.parse(await fs.readFile(storePath(), 'utf8'))
    for (const [k, v] of Object.entries(raw.persist ?? {})) persist.set(k, v)
  } catch {
    // first launch
  }
  try {
    const buf = await fs.readFile(secretsPath())
    const json = safeStorage.isEncryptionAvailable()
      ? safeStorage.decryptString(buf)
      : buf.toString('utf8')
    const parsed = JSON.parse(json)
    for (const [k, v] of Object.entries(parsed)) secrets.set(k, String(v))
  } catch {
    // first launch
  }
}

async function savePersist() {
  const windowBounds = mainWindow && !mainWindow.isDestroyed() ? mainWindow.getBounds() : null
  await fs.mkdir(path.dirname(storePath()), { recursive: true })
  await fs.writeFile(
    storePath(),
    JSON.stringify({ persist: Object.fromEntries(persist), window: windowBounds }, null, 2),
  )
}

async function saveSecrets() {
  const json = JSON.stringify(Object.fromEntries(secrets))
  const buf = safeStorage.isEncryptionAvailable()
    ? safeStorage.encryptString(json)
    : Buffer.from(json, 'utf8')
  await fs.writeFile(secretsPath(), buf)
}

function send(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload)
  }
}

function readBounds() {
  try {
    const raw = persist.get('windowState')
    if (!raw) return { width: 1280, height: 800 }
    const parsed = JSON.parse(raw)
    return {
      x: parsed.x,
      y: parsed.y,
      width: parsed.width ?? 1280,
      height: parsed.height ?? 800,
    }
  } catch {
    return { width: 1280, height: 800 }
  }
}

function persistBounds() {
  if (!mainWindow || mainWindow.isDestroyed()) return
  persist.set('windowState', JSON.stringify(mainWindow.getBounds()))
  void savePersist()
}

function createWindow() {
  const bounds = readBounds()

  mainWindow = new BrowserWindow({
    ...bounds,
    minWidth: 360,
    minHeight: 500,
    title: 'PostAll',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  mainWindow.on('close', persistBounds)
  mainWindow.on('moved', persistBounds)
  mainWindow.on('resized', persistBounds)

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  void mainWindow.loadURL('app://localhost/')
}

function registerIpc() {
  ipcMain.handle('persist:get', (_e, key) => persist.get(key) ?? null)
  ipcMain.handle('persist:set', async (_e, key, value) => {
    persist.set(key, value)
    await savePersist()
  })
  ipcMain.handle('persist:remove', async (_e, key) => {
    persist.delete(key)
    await savePersist()
  })
  ipcMain.handle('secret:get', (_e, key) => secrets.get(key) ?? null)
  ipcMain.handle('secret:set', async (_e, key, value) => {
    secrets.set(key, value)
    await saveSecrets()
  })
  ipcMain.handle('secret:delete', async (_e, key) => {
    secrets.delete(key)
    await saveSecrets()
  })
  ipcMain.handle('files:open', async (_e, options) => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: options?.multiple ? ['openFile', 'multiSelections'] : ['openFile'],
    })
    if (result.canceled) return []
    const files = []
    for (const filePath of result.filePaths) {
      const data = await fs.readFile(filePath)
      files.push({
        name: path.basename(filePath),
        type: '',
        data: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
      })
    }
    return files
  })
  ipcMain.handle('files:save', async (_e, defaultName, data, mime) => {
    const result = await dialog.showSaveDialog(mainWindow, { defaultPath: defaultName })
    if (result.canceled || !result.filePath) return false
    await fs.writeFile(result.filePath, Buffer.from(data))
    void mime
    return true
  })
  ipcMain.handle('notify', (_e, title, body) => {
    if (Notification.isSupported()) new Notification({ title, body }).show()
  })
  ipcMain.handle('shell:open', (_e, url) => shell.openExternal(url))
  ipcMain.handle('window:getState', () => (mainWindow ? mainWindow.getBounds() : null))
  ipcMain.handle('window:setState', (_e, state) => {
    if (mainWindow && state) mainWindow.setBounds(state)
  })
  ipcMain.handle('menu:set', (_e, template) => {
    const menu = Menu.buildFromTemplate(
      template.map((group) => ({
        label: group.label,
        submenu: group.submenu.map((item) => {
          if (item.type === 'separator') return { type: 'separator' }
          if (item.type === 'role') return { role: item.role }
          return {
            label: item.label,
            accelerator: item.accelerator,
            click: () => send('menu-action', item.id),
          }
        }),
      })),
    )
    Menu.setApplicationMenu(menu)
  })
}

function registerProtocol() {
  if (process.defaultApp) {
    if (process.argv.length >= 2) {
      app.setAsDefaultProtocolClient('postall', process.execPath, [path.resolve(process.argv[1])])
    }
  } else {
    app.setAsDefaultProtocolClient('postall')
  }
  app.on('open-url', (event, url) => {
    event.preventDefault()
    send('deep-link', url)
  })
}

app.whenReady().then(async () => {
  protocol.handle('app', (request) => {
    const url = new URL(request.url)
    if (isApiPath(url.pathname)) return proxyToApi(request, url)
    const file = resolveFrontendFile(url.pathname)
    return net.fetch(pathToFileURL(file).href)
  })
  await loadStores()
  registerIpc()
  registerProtocol()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
