import { createContext, useContext } from 'react'

export type EncryptionPhase = 'loading' | 'unconfigured' | 'locked' | 'unlocked'

export type DecryptedBody =
  | { status: 'plain'; text: string }
  | { status: 'locked' }
  | { status: 'undecryptable' }
  | { status: 'pending' }

export type PreparedSetup = {
  /** 一度だけ利用者に見せる復旧キー */
  recoveryKey: string
  confirm: () => Promise<void>
  discard: () => void
}

export type CurrentSecret =
  | { kind: 'passphrase'; passphrase: string }
  | { kind: 'recovery'; recoveryKey: string }

export type PreparedRotation = {
  recoveryKey: string
  confirm: () => Promise<void>
  discard: () => void
}

export class EncryptionAlreadyConfiguredError extends Error {
  constructor() {
    super('別の端末で初期設定が完了しています')
    this.name = 'EncryptionAlreadyConfiguredError'
  }
}

export class EncryptionLockedError extends Error {
  constructor() {
    super('解錠されていません')
    this.name = 'EncryptionLockedError'
  }
}

export type EncryptionContextValue = {
  phase: EncryptionPhase
  keyId: string | null
  dataKey: CryptoKey | null
  generation: number
  canPersist: boolean
  /** 今の解錠を端末に記憶しているか。記憶していないときだけ自動ロックする */
  persisted: boolean
  promptNewPassphrase: boolean
  /** 初期設定の確定が 409 だったとき、解錠へ切り替えた理由 */
  setupConflict: boolean
  dismissNewPassphrase: () => void
  /** パスフレーズから鍵束を用意する。保管の確認のあと confirm で登録する */
  prepareSetup: (passphrase: string) => Promise<PreparedSetup>
  unlockWithPassphrase: (passphrase: string, remember: boolean) => Promise<void>
  unlockWithRecoveryKey: (recoveryKey: string, remember: boolean) => Promise<void>
  /** ロック中なら解錠ダイアログを出し、解錠できたら true。入力は呼び出し側が保持する */
  requestUnlock: () => Promise<boolean>
  /** 未設定なら初期設定ダイアログを出し、完了したら true */
  requestSetup: () => Promise<boolean>
  cancelDialog: () => void
  dialog: 'setup' | 'unlock' | null
  lock: () => Promise<void>
  forget: () => Promise<void>
  encryptBody: (plaintext: string) => Promise<string>
  cacheSlot: (ciphertext: string) => string | null | undefined
  rememberDecryption: (ciphertext: string, plaintext: string | null) => void
  changePassphrase: (current: CurrentSecret, nextPassphrase: string) => Promise<void>
  prepareRecoveryRotation: (current: CurrentSecret) => Promise<PreparedRotation>
  /** テストとダイアログから、今のダイアログを開く */
  openDialog: (dialog: 'setup' | 'unlock') => void
}

export const EncryptionContext = createContext<EncryptionContextValue | null>(null)

export function useEncryption(): EncryptionContextValue {
  const value = useContext(EncryptionContext)
  if (!value) throw new Error('useEncryption must be used within EncryptionProvider')
  return value
}

/** プロバイダの外（既存の単体テスト）では、暗号化しないチャネルとして振る舞う。 */
export function useEncryptionOptional(): EncryptionContextValue | null {
  return useContext(EncryptionContext)
}
