import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { createSecretStore } from '../secret-store.mjs'

const FILE = '/userdata/postall-secrets.bin'
const TOKEN = 'refresh-token-value'

/** 中身が平文で読めない、可逆な偽の暗号化。 */
function fakeSafeStorage(available) {
  const state = { available }
  return {
    state,
    isEncryptionAvailable: () => state.available,
    encryptString: (text) => Buffer.concat([Buffer.from('v10'), Buffer.from(text).map((b) => b ^ 0x5a)]),
    decryptString: (buf) => {
      if (buf.subarray(0, 3).toString() !== 'v10') throw new Error('Error while decrypting the ciphertext')
      return Buffer.from(buf.subarray(3).map((b) => b ^ 0x5a)).toString('utf8')
    },
  }
}

function fakeFs(initial = {}) {
  const files = new Map(Object.entries(initial).map(([k, v]) => [k, Buffer.from(v)]))
  const calls = { writeFile: 0, rm: 0 }
  return {
    files,
    calls,
    async readFile(file) {
      if (!files.has(file)) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      return files.get(file)
    },
    async writeFile(file, data) {
      calls.writeFile += 1
      files.set(file, Buffer.from(data))
    },
    async rm(file) {
      calls.rm += 1
      files.delete(file)
    },
    async mkdir() {},
  }
}

function store({ available, files }) {
  const safeStorage = fakeSafeStorage(available)
  const fs = fakeFs(files)
  const warnings = []
  const secrets = createSecretStore({ safeStorage, fs, filePath: FILE, warn: (m) => warnings.push(m) })
  return { secrets, safeStorage, fs, warnings }
}

const tokens = () => new Map([['auth.tokens', JSON.stringify({ refreshToken: TOKEN })]])

describe('createSecretStore with safeStorage available', () => {
  it('writes only ciphertext and restores it on the next load', async () => {
    const { secrets, fs, safeStorage } = store({ available: true })

    await secrets.save(tokens())

    const written = fs.files.get(FILE)
    assert.ok(written, 'secrets file is written')
    assert.ok(!written.toString('utf8').includes(TOKEN), 'token must not appear in plaintext')
    assert.throws(() => JSON.parse(written.toString('utf8')))
    assert.equal(JSON.parse(safeStorage.decryptString(written))['auth.tokens'], tokens().get('auth.tokens'))

    const reloaded = await createSecretStore({ safeStorage, fs, filePath: FILE, warn: () => {} }).load()
    assert.deepEqual(reloaded, tokens())
  })

  it('removes the file when the last secret is deleted', async () => {
    const { secrets, fs } = store({ available: true })
    await secrets.save(tokens())
    await secrets.save(new Map())
    assert.equal(fs.files.has(FILE), false)
  })

  it('returns empty for a missing file without touching the disk', async () => {
    const { secrets, fs } = store({ available: true })
    assert.deepEqual(await secrets.load(), new Map())
    assert.equal(fs.calls.rm, 0)
  })
})

describe('createSecretStore with safeStorage unavailable', () => {
  it('does not write, deletes an existing file, and leaves the in-memory map usable', async () => {
    const { secrets, fs, warnings } = store({ available: false, files: { [FILE]: 'v10stale-ciphertext' } })
    const memory = tokens()

    await secrets.save(memory)
    await secrets.save(memory)

    assert.equal(fs.calls.writeFile, 0)
    assert.equal(fs.files.has(FILE), false)
    assert.equal(memory.get('auth.tokens'), tokens().get('auth.tokens'))
    assert.equal(warnings.length, 1, 'warns only once')
  })

  it('loads nothing and keeps ciphertext for when the keychain comes back', async () => {
    const { secrets, safeStorage, fs } = store({ available: true })
    await secrets.save(tokens())
    safeStorage.state.available = false

    const loaded = await createSecretStore({ safeStorage, fs, filePath: FILE, warn: () => {} }).load()

    assert.deepEqual(loaded, new Map())
    assert.equal(fs.files.has(FILE), true)
  })
})

describe('createSecretStore with leftover files', () => {
  for (const available of [true, false]) {
    it(`does not read a plaintext JSON file and deletes it (safeStorage ${available ? 'available' : 'unavailable'})`, async () => {
      const plaintext = JSON.stringify({ 'auth.tokens': JSON.stringify({ refreshToken: TOKEN }) })
      const { secrets, fs } = store({ available, files: { [FILE]: plaintext } })

      const loaded = await secrets.load()

      assert.deepEqual(loaded, new Map())
      assert.equal(fs.files.has(FILE), false)
    })
  }

  it('returns empty for an undecryptable file and deletes it', async () => {
    const { secrets, fs } = store({ available: true, files: { [FILE]: '\u0000\u0001garbage' } })

    assert.deepEqual(await secrets.load(), new Map())
    assert.equal(fs.files.has(FILE), false)
  })

  it('returns empty for ciphertext that does not hold a JSON object and deletes it', async () => {
    const { secrets, safeStorage, fs } = store({ available: true })
    fs.files.set(FILE, safeStorage.encryptString('not json'))

    assert.deepEqual(await secrets.load(), new Map())
    assert.equal(fs.files.has(FILE), false)
  })
})
