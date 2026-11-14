import { deriveDataKey } from '@/crypto/keys'
import { KeyStoreUnavailableError, type EncryptionKeyStore, type RememberedKey } from './types'

const DB_NAME = 'postall-keys'
const STORE_NAME = 'keys'
const RECORD_KEY = 'workspace'

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function openDatabase(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = factory.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE_NAME)) req.result.createObjectStore(STORE_NAME)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
    req.onblocked = () => reject(new Error('IndexedDB is blocked'))
  })
}

function isRememberedKey(value: unknown): value is RememberedKey {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Partial<RememberedKey>
  return typeof record.keyId === 'string' && typeof record.dataKey === 'object' && record.dataKey?.type === 'secret'
}

/**
 * ブラウザ（PWA・会社支給 Mac）用。取り出せない暗号鍵を IndexedDB の `postall-keys` に置く。
 * 構造化複製で保存するので、スクリプトから鍵の値を読み出す手段は無い。
 */
export function createIndexedDbKeyStore(factory: IDBFactory | undefined = globalThis.indexedDB): EncryptionKeyStore {
  const withStore = async <T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>) => {
    if (!factory) throw new KeyStoreUnavailableError()
    const db = await openDatabase(factory)
    try {
      const tx = db.transaction(STORE_NAME, mode)
      const done = new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
        tx.onabort = () => reject(tx.error)
      })
      const [result] = await Promise.all([request(run(tx.objectStore(STORE_NAME))), done])
      return result
    } finally {
      db.close()
    }
  }

  return {
    async canPersist() {
      if (!factory) return false
      try {
        await withStore('readonly', (store) => store.count())
        return true
      } catch {
        return false
      }
    },
    async save(keyId, masterKey) {
      const dataKey = await deriveDataKey(masterKey, keyId)
      await withStore('readwrite', (store) => store.put({ keyId, dataKey } satisfies RememberedKey, RECORD_KEY))
    },
    async load() {
      if (!factory) return null
      try {
        const record: unknown = await withStore('readonly', (store) => store.get(RECORD_KEY))
        return isRememberedKey(record) ? record : null
      } catch {
        return null
      }
    },
    async clear() {
      if (!factory) return
      await withStore('readwrite', (store) => store.delete(RECORD_KEY))
    },
  }
}

/** テスト用。メモリにだけ置く。persist が偽なら記憶できない端末として振る舞う。 */
export function createMemoryKeyStore(options: { persist?: boolean } = {}): EncryptionKeyStore {
  let remembered: RememberedKey | null = null
  const persist = options.persist ?? true
  return {
    async canPersist() {
      return persist
    },
    async save(keyId, masterKey) {
      if (!persist) throw new KeyStoreUnavailableError()
      remembered = { keyId, dataKey: await deriveDataKey(masterKey, keyId) }
    },
    async load() {
      return remembered
    },
    async clear() {
      remembered = null
    },
  }
}
