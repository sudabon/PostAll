import type { Capability, MenuTemplate, PickedFile, PlatformAdapter, WindowState } from './types'

const caps: Record<Capability, boolean> = {
  appMenu: false,
  globalShortcuts: false,
  nativeFileOpen: false,
  nativeFileSave: false,
  osNotifications: true,
  secureCredentials: false,
  windowState: false,
}

const secrets = new Map<string, string>()

function sessionSecretKey(key: string) {
  return `postall:secret:${key}`
}

export function createBrowserAdapter(): PlatformAdapter {
  const menuListeners = new Set<(id: string) => void>()
  const shortcutListeners = new Set<(id: string) => void>()
  const deepLinkListeners = new Set<(url: string) => void>()

  return {
    kind: 'browser',
    has: (c) => caps[c],
    async getItem(key) {
      try {
        return localStorage.getItem(`postall:${key}`)
      } catch {
        return null
      }
    },
    async setItem(key, value) {
      localStorage.setItem(`postall:${key}`, value)
    },
    async removeItem(key) {
      localStorage.removeItem(`postall:${key}`)
    },
    async getSecret(key) {
      const mem = secrets.get(key)
      if (mem != null) return mem
      try {
        return sessionStorage.getItem(sessionSecretKey(key))
      } catch {
        return null
      }
    },
    async setSecret(key, value) {
      secrets.set(key, value)
      try {
        sessionStorage.setItem(sessionSecretKey(key), value)
      } catch {
        // private mode などではメモリのみ
      }
    },
    async deleteSecret(key) {
      secrets.delete(key)
      try {
        sessionStorage.removeItem(sessionSecretKey(key))
      } catch {
        // ignore
      }
    },
    async pickFiles(options) {
      return new Promise((resolve) => {
        const input = document.createElement('input')
        input.type = 'file'
        input.multiple = Boolean(options?.multiple)
        if (options?.accept) input.accept = options.accept
        input.onchange = async () => {
          const files = [...(input.files ?? [])]
          const picked: PickedFile[] = []
          for (const file of files) {
            picked.push({ name: file.name, type: file.type, data: await file.arrayBuffer() })
          }
          resolve(picked)
        }
        input.click()
      })
    },
    async ingestFiles(files) {
      const picked: PickedFile[] = []
      for (const file of files) {
        picked.push({ name: file.name, type: file.type, data: await file.arrayBuffer() })
      }
      return picked
    },
    async saveFile(defaultName, data, mime) {
      const copy = new Uint8Array(data.byteLength)
      copy.set(data)
      const blob = new Blob([copy], { type: mime ?? 'application/octet-stream' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = defaultName
      a.click()
      URL.revokeObjectURL(url)
      return true
    },
    async notify(title, body) {
      if (!('Notification' in window)) return
      if (Notification.permission === 'default') await Notification.requestPermission()
      if (Notification.permission === 'granted') new Notification(title, { body })
    },
    async openExternal(url) {
      window.open(url, '_blank', 'noopener,noreferrer')
    },
    async getWindowState() {
      return null
    },
    async setWindowState(_state: WindowState) {},
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
  }
}
