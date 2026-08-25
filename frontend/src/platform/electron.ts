import type { MenuTemplate, PickedFile, PlatformAdapter, WindowState } from './types'

type Bridge = {
  kind: 'electron'
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>
  on: (channel: string, listener: (payload: unknown) => void) => () => void
}

function bridge(): Bridge {
  const b = window.postallPlatform
  if (!b) {
    throw new Error('Electron ブリッジがありません')
  }
  return b
}

export function createElectronAdapter(): PlatformAdapter {
  const b = bridge()
  return {
    kind: 'electron',
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
