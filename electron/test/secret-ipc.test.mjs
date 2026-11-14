import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { ENCRYPTION_SECRET_KEY, registerSecretIpc } from '../secret-ipc.mjs'
import { createSecretStore } from '../secret-store.mjs'

const MASTER_KEY = JSON.stringify({ keyId: 'key-1', masterKey: 'bWFzdGVyLWtleS12YWx1ZQ' })

function setup({ available }) {
  const handlers = new Map()
  const ipcMain = { handle: (channel, fn) => handlers.set(channel, fn) }
  const safeStorage = {
    isEncryptionAvailable: () => available,
    encryptString: (text) => Buffer.concat([Buffer.from('v10'), Buffer.from(text).map((b) => b ^ 0x5a)]),
    decryptString: (buf) => Buffer.from(buf.subarray(3).map((b) => b ^ 0x5a)).toString('utf8'),
  }
  const files = new Map()
  const fs = {
    async readFile(file) {
      if (!files.has(file)) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      return files.get(file)
    },
    async writeFile(file, data) {
      files.set(file, Buffer.from(data))
    },
    async rm(file) {
      files.delete(file)
    },
    async mkdir() {},
  }
  const store = createSecretStore({ safeStorage, fs, filePath: '/userdata/postall-secrets.bin', warn: () => {} })
  const secrets = new Map()
  registerSecretIpc({ ipcMain, safeStorage, secrets, save: () => store.save(secrets) })
  const invoke = (channel, ...args) => handlers.get(channel)({}, ...args)
  return { invoke, secrets, files }
}

describe('secret IPC with safeStorage unavailable', () => {
  it('reports that keys cannot persist and refuses to remember the encryption key', async () => {
    const { invoke, secrets, files } = setup({ available: false })

    assert.equal(await invoke('secret:persistent'), false)
    await assert.rejects(invoke('secret:set', ENCRYPTION_SECRET_KEY, MASTER_KEY))

    assert.equal(secrets.has(ENCRYPTION_SECRET_KEY), false, 'not kept even in memory')
    assert.equal(await invoke('secret:get', ENCRYPTION_SECRET_KEY), null)
    assert.equal(files.size, 0)
  })

  it('still keeps sign-in tokens in memory only, as before', async () => {
    const { invoke, files } = setup({ available: false })
    await invoke('secret:set', 'auth.tokens', '{"refreshToken":"r"}')
    assert.equal(await invoke('secret:get', 'auth.tokens'), '{"refreshToken":"r"}')
    assert.equal(files.size, 0)
  })
})

describe('secret IPC with safeStorage available', () => {
  it('persists the encryption key only as ciphertext and deletes it on request', async () => {
    const { invoke, files } = setup({ available: true })

    assert.equal(await invoke('secret:persistent'), true)
    await invoke('secret:set', ENCRYPTION_SECRET_KEY, MASTER_KEY)
    assert.equal(await invoke('secret:get', ENCRYPTION_SECRET_KEY), MASTER_KEY)
    const written = [...files.values()][0]
    assert.ok(written, 'secrets file is written')
    assert.ok(!written.toString('utf8').includes('bWFzdGVyLWtleS12YWx1ZQ'), 'key value must not appear in plaintext')

    await invoke('secret:delete', ENCRYPTION_SECRET_KEY)
    assert.equal(await invoke('secret:get', ENCRYPTION_SECRET_KEY), null)
    assert.equal(files.size, 0)
  })
})
