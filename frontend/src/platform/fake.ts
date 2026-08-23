import type { Capability, MenuTemplate, PickedFile, PlatformAdapter, WindowState } from './types'

type Memory = {
  items: Map<string, string>
  secrets: Map<string, string>
}

export type FakeAdapterOptions = {
  durable?: Storage
  capabilities?: Partial<Record<Capability, boolean>>
  seedSecrets?: Record<string, string>
  files?: PickedFile[]
}

const defaultCaps: Record<Capability, boolean> = {
  appMenu: true,
  globalShortcuts: true,
  nativeFileOpen: true,
  nativeFileSave: true,
  osNotifications: true,
  secureCredentials: true,
  windowState: true,
}

export function createFakeAdapter(options: FakeAdapterOptions = {}): PlatformAdapter {
  const mem: Memory = {
    items: new Map(),
    secrets: new Map(Object.entries(options.seedSecrets ?? {})),
  }
  if (options.durable) {
    for (let i = 0; i < options.durable.length; i += 1) {
      const key = options.durable.key(i)
      if (key?.startsWith('postall:item:')) {
        mem.items.set(key.slice('postall:item:'.length), options.durable.getItem(key) ?? '')
      }
      if (key?.startsWith('postall:secret:')) {
        mem.secrets.set(key.slice('postall:secret:'.length), options.durable.getItem(key) ?? '')
      }
    }
  }
  const caps = { ...defaultCaps, ...options.capabilities }
  const menuListeners = new Set<(id: string) => void>()
  const shortcutListeners = new Set<(id: string) => void>()
  const deepLinkListeners = new Set<(url: string) => void>()

  const persist = (kind: 'item' | 'secret', key: string, value: string | null) => {
    if (!options.durable) return
    const full = `postall:${kind}:${key}`
    if (value == null) options.durable.removeItem(full)
    else options.durable.setItem(full, value)
  }

  const adapter: PlatformAdapter & { emitMenu: (id: string) => void; emitShortcut: (id: string) => void; emitDeepLink: (url: string) => void } = {
    kind: 'fake',
    has: (c) => caps[c] !== false,
    async getItem(key) {
      return mem.items.get(key) ?? null
    },
    async setItem(key, value) {
      mem.items.set(key, value)
      persist('item', key, value)
    },
    async removeItem(key) {
      mem.items.delete(key)
      persist('item', key, null)
    },
    async getSecret(key) {
      return mem.secrets.get(key) ?? null
    },
    async setSecret(key, value) {
      mem.secrets.set(key, value)
      persist('secret', key, value)
    },
    async deleteSecret(key) {
      mem.secrets.delete(key)
      persist('secret', key, null)
    },
    async pickFiles() {
      return options.files ?? []
    },
    async ingestFiles(files) {
      const picked: PickedFile[] = []
      for (const file of files) {
        const data =
          typeof file.arrayBuffer === 'function'
            ? await file.arrayBuffer()
            : await new Promise<ArrayBuffer>((resolve, reject) => {
                const reader = new FileReader()
                reader.onload = () => resolve(reader.result as ArrayBuffer)
                reader.onerror = () => reject(reader.error)
                reader.readAsArrayBuffer(file)
              })
        picked.push({ name: file.name, type: file.type, data })
      }
      return picked
    },
    async saveFile() {
      return true
    },
    async notify() {},
    async openExternal() {},
    async getWindowState() {
      const raw = mem.items.get('windowState')
      return raw ? (JSON.parse(raw) as WindowState) : null
    },
    async setWindowState(state) {
      mem.items.set('windowState', JSON.stringify(state))
      persist('item', 'windowState', JSON.stringify(state))
    },
    async setMenu(_template: MenuTemplate) {},
    onMenuAction(handler) {
      menuListeners.add(handler)
      return () => menuListeners.delete(handler)
    },
    onShortcut(handler) {
      shortcutListeners.add(handler)
      return () => shortcutListeners.delete(handler)
    },
    onDeepLink(handler) {
      deepLinkListeners.add(handler)
      return () => deepLinkListeners.delete(handler)
    },
    emitMenu(id) {
      menuListeners.forEach((fn) => fn(id))
    },
    emitShortcut(id) {
      shortcutListeners.forEach((fn) => fn(id))
    },
    emitDeepLink(url) {
      deepLinkListeners.forEach((fn) => fn(url))
    },
  }
  return adapter
}
