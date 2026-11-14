import { afterEach, describe, expect, it, vi } from 'vitest'
import { toBase64Url } from '@/crypto/encoding'
import { decryptPost, encryptPost } from '@/crypto/envelope'
import { deriveDataKey, generateMasterKey } from '@/crypto/keys'
import { createBrowserAdapter } from './browser'
import { createElectronKeyStore, ENCRYPTION_SECRET_KEY } from './electron'
import { createFakeAdapter } from './fake'
import { createIndexedDbKeyStore, createMemoryKeyStore } from './key-store'
import { KeyStoreUnavailableError } from './types'

const KEY_ID = '0b6c5c1e-8d2a-4f7e-9c3b-1a2b3c4d5e6f'

function storageText(storage: Storage) {
  const out: string[] = []
  for (let i = 0; i < storage.length; i += 1) {
    const key = storage.key(i)!
    out.push(key, storage.getItem(key) ?? '')
  }
  return out.join('\n')
}

/** 記憶から復元した鍵で、元のマスター鍵の暗号文が読めるか。 */
async function canRead(dataKey: CryptoKey, master: Uint8Array) {
  const envelope = await encryptPost(await deriveDataKey(master, KEY_ID), KEY_ID, 'remembered')
  return (await decryptPost(dataKey, KEY_ID, envelope)) === 'remembered'
}

afterEach(() => {
  localStorage.clear()
})

describe('memory key store (fake adapter)', () => {
  it('saves, restores and clears a non-extractable key without touching localStorage', async () => {
    const adapter = createFakeAdapter({ durable: localStorage })
    const master = generateMasterKey()
    expect(await adapter.encryptionKeyStore.canPersist()).toBe(true)

    await adapter.encryptionKeyStore.save(KEY_ID, master)
    const restored = await adapter.encryptionKeyStore.load()
    expect(restored?.keyId).toBe(KEY_ID)
    expect(restored?.dataKey.extractable).toBe(false)
    expect(await canRead(restored!.dataKey, master)).toBe(true)
    expect(storageText(localStorage)).not.toContain(toBase64Url(master))
    expect(localStorage.length).toBe(0)

    await adapter.encryptionKeyStore.clear()
    expect(await adapter.encryptionKeyStore.load()).toBeNull()
  })

  it('refuses to remember when the device cannot persist keys', async () => {
    const store = createMemoryKeyStore({ persist: false })
    expect(await store.canPersist()).toBe(false)
    await expect(store.save(KEY_ID, generateMasterKey())).rejects.toBeInstanceOf(KeyStoreUnavailableError)
    expect(await store.load()).toBeNull()
  })
})

describe('IndexedDB key store (browser adapter)', () => {
  it('reports that it cannot persist and writes nothing when IndexedDB is unavailable', async () => {
    // jsdom には IndexedDB が無い。保存・復元・取り出せないことは E2E（TP-017）で確かめる。
    const adapter = createBrowserAdapter()
    expect(await adapter.encryptionKeyStore.canPersist()).toBe(false)
    const master = generateMasterKey()
    await expect(adapter.encryptionKeyStore.save(KEY_ID, master)).rejects.toBeInstanceOf(KeyStoreUnavailableError)
    expect(await adapter.encryptionKeyStore.load()).toBeNull()
    await adapter.encryptionKeyStore.clear()
    expect(storageText(localStorage)).not.toContain(toBase64Url(master))
  })

  it('stores only the key id and a non-extractable CryptoKey', async () => {
    const put = vi.fn()
    const record: { value?: unknown } = {}
    const factory = fakeIndexedDb(record, put)
    const store = createIndexedDbKeyStore(factory)
    const master = generateMasterKey()

    expect(await store.canPersist()).toBe(true)
    await store.save(KEY_ID, master)
    expect(put).toHaveBeenCalledTimes(1)
    const saved = record.value as { keyId: string; dataKey: CryptoKey }
    expect(Object.keys(saved).sort()).toEqual(['dataKey', 'keyId'])
    expect(saved.dataKey.extractable).toBe(false)
    await expect(crypto.subtle.exportKey('raw', saved.dataKey)).rejects.toThrow()

    const restored = await store.load()
    expect(restored?.keyId).toBe(KEY_ID)
    expect(await canRead(restored!.dataKey, master)).toBe(true)

    await store.clear()
    expect(await store.load()).toBeNull()
  })
})

describe('Electron key store', () => {
  function bridge(persistent: boolean) {
    const secrets = new Map<string, string>()
    const invoke = vi.fn(async (channel: string, key?: unknown, value?: unknown) => {
      if (channel === 'secret:persistent') return persistent
      if (channel === 'secret:get') return secrets.get(String(key)) ?? null
      if (channel === 'secret:set') secrets.set(String(key), String(value))
      if (channel === 'secret:delete') secrets.delete(String(key))
      return undefined
    })
    return { invoke, secrets }
  }

  it('keeps the master key in secret storage and restores a non-extractable data key', async () => {
    const b = bridge(true)
    const store = createElectronKeyStore(b)
    const master = generateMasterKey()

    expect(await store.canPersist()).toBe(true)
    await store.save(KEY_ID, master)
    expect(b.secrets.has(ENCRYPTION_SECRET_KEY)).toBe(true)
    const restored = await store.load()
    expect(restored?.dataKey.extractable).toBe(false)
    expect(await canRead(restored!.dataKey, master)).toBe(true)

    await store.clear()
    expect(b.secrets.size).toBe(0)
    expect(await store.load()).toBeNull()
  })

  it('does not save when safeStorage is unavailable', async () => {
    const b = bridge(false)
    const store = createElectronKeyStore(b)

    expect(await store.canPersist()).toBe(false)
    await expect(store.save(KEY_ID, generateMasterKey())).rejects.toBeInstanceOf(KeyStoreUnavailableError)
    expect(b.invoke.mock.calls.some(([channel]) => channel === 'secret:set')).toBe(false)
    expect(b.secrets.size).toBe(0)
  })
})

/** put / get / delete / count だけを持つ IndexedDB の代用品。値は構造化複製せずにそのまま持つ。 */
function fakeIndexedDb(record: { value?: unknown }, onPut: (value: unknown) => void): IDBFactory {
  const settle = <T>(result: () => T) => {
    const req = {} as IDBRequest<T> & { result: T }
    queueMicrotask(() => {
      Object.defineProperty(req, 'result', { value: result() })
      req.onsuccess?.call(req, new Event('success'))
    })
    return req
  }
  const objectStore = {
    put: (value: unknown) => settle(() => {
      onPut(value)
      record.value = value
      return 'workspace'
    }),
    get: () => settle(() => record.value),
    delete: () => settle(() => {
      record.value = undefined
      return undefined
    }),
    count: () => settle(() => (record.value === undefined ? 0 : 1)),
  }
  const db = {
    objectStoreNames: { contains: () => true },
    transaction: () => {
      const tx = { objectStore: () => objectStore } as unknown as IDBTransaction
      setTimeout(() => tx.oncomplete?.call(tx, new Event('complete')))
      return tx
    },
    close: () => {},
  }
  return {
    open: () => {
      const req = {} as IDBOpenDBRequest
      queueMicrotask(() => {
        Object.defineProperty(req, 'result', { value: db })
        req.onsuccess?.call(req, new Event('success'))
      })
      return req
    },
  } as unknown as IDBFactory
}
