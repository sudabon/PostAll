export type {
  Capability,
  EncryptionKeyStore,
  MenuTemplate,
  PickedFile,
  PlatformAdapter,
  RememberedKey,
  WindowState,
} from './types'
export { KeyStoreUnavailableError } from './types'
export { PlatformProvider, usePlatform, getPlatform } from './context'
export { createFakeAdapter } from './fake'
export { createMemoryKeyStore } from './key-store'
export { createPlatformAdapter } from './create'
