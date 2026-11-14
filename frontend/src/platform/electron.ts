import { deriveDataKey } from '@/crypto/keys'
import { fromBase64Url, toBase64Url } from '@/crypto/encoding'
import {
  KeyStoreUnavailableError,
  type EncryptionKeyStore,
  type MenuTemplate,
  type PickedFile,
  type PlatformAdapter,
  type WindowState,
} from './types'

type Bridge = {
  kind: 'electron'
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>
  on: (channel: string, listener: (payload: unknown) => void) => () => void
}

/** メインプロセスの secret-ipc.mjs と同じ名前。safeStorage が使えないときは保存を拒まれる。 */
export const ENCRYPTION_SECRET_KEY = 'encryption.masterKey'

function bridge(): Bridge {
  const b = window.postallPlatform
  if (!b) {
    throw new Error('Electron ブリッジがありません')
  }
  return b
}

/**
 * マスター鍵の値を、既存の secret:*（safeStorage で暗号化したファイル）に置く。
 * 読み出したら暗号鍵を導いて、値はすぐに消す。
 */
export function createElectronKeyStore(b: Pick<Bridge, 'invoke'>): EncryptionKeyStore {
  const canPersist = async () => (await b.invoke('secret:persistent')) === true
  return {
    canPersist,
    async save(keyId, masterKey) {
      if (!(await canPersist())) throw new KeyStoreUnavailableError()
      await b.invoke('secret:set', ENCRYPTION_SECRET_KEY, JSON.stringify({ keyId, masterKey: toBase64Url(masterKey) }))
    },
    async load() {
      const raw = await b.invoke('secret:get', ENCRYPTION_SECRET_KEY)
      if (typeof raw !== 'string') return null
      try {
        const parsed = JSON.parse(raw) as { keyId?: unknown; masterKey?: unknown }
        if (typeof parsed.keyId !== 'string' || typeof parsed.masterKey !== 'string') return null
        const master = fromBase64Url(parsed.masterKey)
        try {
          return { keyId: parsed.keyId, dataKey: await deriveDataKey(master, parsed.keyId) }
        } finally {
          master.fill(0)
        }
      } catch {
        return null
      }
    },
    async clear() {
      await b.invoke('secret:delete', ENCRYPTION_SECRET_KEY)
    },
  }
}

export function createElectronAdapter(): PlatformAdapter {
  const b = bridge()
  return {
    kind: 'electron',
    encryptionKeyStore: createElectronKeyStore(b),
    has: (_capability) => true,
    getItem: (key) => b.invoke('persist:get', key) as Promise<string | null>,
    setItem: (key, value) => b.invoke('persist:set', key, value) as Promise<void>,
    removeItem: (key) => b.invoke('persist:remove', key) as Promise<void>,
    getSecret: (key) => b.invoke('secret:get', key) as Promise<string | null>,
    setSecret: (key, value) => b.invoke('secret:set', key, value) as Promise<void>,
    deleteSecret: (key) => b.invoke('secret:delete', key) as Promise<void>,
    pickFiles: (options) => b.invoke('files:open', options) as Promise<PickedFile[]>,
    ingestFiles: async (files) => {
      const picked: PickedFile[] = []
      for (const file of files) {
        picked.push({ name: file.name, type: file.type, data: await file.arrayBuffer() })
      }
      return picked
    },
    putBytes: async (url, data, headers, onProgress) => {
      onProgress(0)
      await b.invoke('files:put', url, data, headers)
      onProgress(1)
    },
    getBytes: (url) => b.invoke('files:get', url) as Promise<ArrayBuffer>,
    saveFile: (defaultName, data, mime) =>
      b.invoke('files:save', defaultName, data, mime) as Promise<boolean>,
    notify: (title, body) => b.invoke('notify', title, body) as Promise<void>,
    openExternal: (url) => b.invoke('shell:open', url) as Promise<void>,
    getWindowState: () => b.invoke('window:getState') as Promise<WindowState | null>,
    setWindowState: (state) => b.invoke('window:setState', state) as Promise<void>,
    setMenu: (template: MenuTemplate) => b.invoke('menu:set', template) as Promise<void>,
    onMenuAction: (handler) => b.on('menu-action', (id) => handler(String(id))),
    onShortcut: (handler) => b.on('shortcut', (id) => handler(String(id))),
    onDeepLink: (handler) => b.on('deep-link', (url) => handler(String(url))),
  }
}
