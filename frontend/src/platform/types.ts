export type PlatformKind = 'electron' | 'browser' | 'fake'

export type Capability =
  | 'appMenu'
  | 'globalShortcuts'
  | 'nativeFileOpen'
  | 'nativeFileSave'
  | 'osNotifications'
  | 'secureCredentials'
  | 'windowState'

export type WindowState = {
  x?: number
  y?: number
  width: number
  height: number
}

export type MenuItemSpec =
  | { type: 'separator' }
  | { type: 'role'; role: string }
  | { id: string; label: string; accelerator?: string }

export type MenuTemplate = { label: string; submenu: MenuItemSpec[] }[]

export type PickedFile = {
  name: string
  type: string
  data: ArrayBuffer
}

export interface PlatformAdapter {
  readonly kind: PlatformKind
  has(capability: Capability): boolean
  getItem(key: string): Promise<string | null>
  setItem(key: string, value: string): Promise<void>
  removeItem(key: string): Promise<void>
  getSecret(key: string): Promise<string | null>
  setSecret(key: string, value: string): Promise<void>
  deleteSecret(key: string): Promise<void>
  pickFiles(options?: { multiple?: boolean; accept?: string }): Promise<PickedFile[]>
  ingestFiles(files: File[]): Promise<PickedFile[]>
  saveFile(defaultName: string, data: Uint8Array, mime?: string): Promise<boolean>
  notify(title: string, body: string): Promise<void>
  openExternal(url: string): Promise<void>
  getWindowState(): Promise<WindowState | null>
  setWindowState(state: WindowState): Promise<void>
  setMenu(template: MenuTemplate): Promise<void>
  onMenuAction(handler: (id: string) => void): () => void
  onShortcut(handler: (id: string) => void): () => void
  onDeepLink(handler: (url: string) => void): () => void
}
