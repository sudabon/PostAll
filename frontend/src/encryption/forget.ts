let forgetImpl: (() => Promise<void>) | null = null

/** EncryptionProvider が登録する。サインアウトの経路から呼ぶ。 */
export function registerEncryptionForget(fn: () => Promise<void>): () => void {
  forgetImpl = fn
  return () => {
    if (forgetImpl === fn) forgetImpl = null
  }
}

export function forgetEncryption(): Promise<void> {
  return forgetImpl?.() ?? Promise.resolve()
}
