import path from 'node:path'

const UNAVAILABLE_WARNING =
  '[postall] safeStorage is unavailable; secrets are kept in memory only and are not written to disk'

function isPlaintextJson(buf) {
  try {
    JSON.parse(buf.toString('utf8'))
    return true
  } catch {
    return false
  }
}

/**
 * トークンなどの秘密情報を、OS の安全な保管領域（safeStorage）で暗号化してファイルに置く。
 * safeStorage が使えないときはファイルへ書かない。値は呼び出し側のメモリにだけ残るので、
 * そのプロセスの間はサインイン状態が続き、再起動するとサインインを求める。
 *
 * @param {object} deps
 * @param {Pick<Electron.SafeStorage, 'isEncryptionAvailable' | 'encryptString' | 'decryptString'>} deps.safeStorage
 * @param {Pick<typeof import('node:fs/promises'), 'readFile' | 'writeFile' | 'rm' | 'mkdir'>} deps.fs
 * @param {string} deps.filePath
 * @param {(message: string) => void} [deps.warn]
 */
export function createSecretStore({ safeStorage, fs, filePath, warn = console.warn }) {
  let warned = false
  const warnUnavailable = () => {
    if (warned) return
    warned = true
    warn(UNAVAILABLE_WARNING)
  }

  async function readFileOrNull() {
    try {
      return await fs.readFile(filePath)
    } catch (err) {
      if (err?.code === 'ENOENT') return null
      throw err
    }
  }

  async function clear() {
    await fs.rm(filePath, { force: true })
  }

  /** @returns {Promise<Map<string, string>>} */
  async function load() {
    const buf = await readFileOrNull()
    if (!buf) return new Map()
    if (!safeStorage.isEncryptionAvailable()) {
      warnUnavailable()
      // 復号できないので読み込まない。過去に平文で書いたファイルは、内容を使わずに消す。
      // 暗号文は、保管領域が戻ったときに読めるよう残す。
      if (isPlaintextJson(buf)) await clear()
      return new Map()
    }
    try {
      const parsed = JSON.parse(safeStorage.decryptString(buf))
      return new Map(Object.entries(parsed).map(([key, value]) => [key, String(value)]))
    } catch {
      // 過去の平文保存、または壊れた暗号文。どちらも内容を使わずに消す。
      await clear()
      return new Map()
    }
  }

  /** @param {Map<string, string>} secrets */
  async function save(secrets) {
    if (!safeStorage.isEncryptionAvailable()) {
      warnUnavailable()
      await clear()
      return
    }
    if (secrets.size === 0) {
      await clear()
      return
    }
    const buf = safeStorage.encryptString(JSON.stringify(Object.fromEntries(secrets)))
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    await fs.writeFile(filePath, buf)
  }

  return { load, save, clear }
}
