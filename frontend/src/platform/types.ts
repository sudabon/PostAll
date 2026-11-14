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

/** 端末に記憶した解錠状態。暗号鍵は取り出せない（non-extractable）CryptoKey で返す。 */
export type RememberedKey = {
  keyId: string
  dataKey: CryptoKey
}

/**
 * 解錠した状態を端末に記憶する保管場所（design.md D6）。
 * パスフレーズと復旧キーは記憶しない。安全に記憶できない端末では save が失敗する。
 */
export interface EncryptionKeyStore {
  canPersist(): Promise<boolean>
  save(keyId: string, masterKey: Uint8Array): Promise<void>
  load(): Promise<RememberedKey | null>
  clear(): Promise<void>
}

export class KeyStoreUnavailableError extends Error {
  constructor() {
    super('この端末では鍵を安全に記憶できません')
    this.name = 'KeyStoreUnavailableError'
  }
}

export interface PlatformAdapter {
  readonly kind: PlatformKind
  readonly encryptionKeyStore: EncryptionKeyStore
  has(capability: Capability): boolean
  getItem(key: string): Promise<string | null>
  setItem(key: string, value: string): Promise<void>
  removeItem(key: string): Promise<void>
  getSecret(key: string): Promise<string | null>
  setSecret(key: string, value: string): Promise<void>
  deleteSecret(key: string): Promise<void>
  pickFiles(options?: { multiple?: boolean; accept?: string }): Promise<PickedFile[]>
  ingestFiles(files: File[]): Promise<PickedFile[]>
  putBytes(
    url: string,
    data: ArrayBuffer,
    headers: Record<string, string>,
    onProgress: (ratio: number) => void,
  ): Promise<void>
  getBytes(url: string): Promise<ArrayBuffer>
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
