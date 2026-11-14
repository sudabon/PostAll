/** レンダラの electron adapter と同じ名前。暗号化チャネルのマスター鍵を置く。 */
export const ENCRYPTION_SECRET_KEY = 'encryption.masterKey'

// safeStorage が使えないときは、メモリにも置かない秘密。端末への記憶そのものを断る。
const PERSIST_ONLY_SECRETS = new Set([ENCRYPTION_SECRET_KEY])

/**
 * secret:* の IPC を登録する。
 *
 * @param {object} deps
 * @param {Pick<Electron.IpcMain, 'handle'>} deps.ipcMain
 * @param {Pick<Electron.SafeStorage, 'isEncryptionAvailable'>} deps.safeStorage
 * @param {Map<string, string>} deps.secrets メインプロセスのメモリ上の値
 * @param {() => Promise<void>} deps.save secrets をファイルへ書く（secret-store.mjs）
 */
export function registerSecretIpc({ ipcMain, safeStorage, secrets, save }) {
  ipcMain.handle('secret:get', (_e, key) => secrets.get(key) ?? null)
  ipcMain.handle('secret:set', async (_e, key, value) => {
    if (PERSIST_ONLY_SECRETS.has(key) && !safeStorage.isEncryptionAvailable()) {
      throw new Error('secure storage is unavailable; refusing to remember the encryption key')
    }
    secrets.set(key, value)
    await save()
  })
  ipcMain.handle('secret:delete', async (_e, key) => {
    secrets.delete(key)
    await save()
  })
  // OS の安全な保管領域に書けるか。レンダラは偽なら「この端末で記憶する」を出さない。
  ipcMain.handle('secret:persistent', () => safeStorage.isEncryptionAvailable())
}
