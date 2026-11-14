import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ApiError } from '@/api/client'
import { useAuth } from '@/auth/auth-context'
import {
  deriveDataKey,
  deriveKeyProof,
  generateMasterKey,
  unwrapMasterKey,
  wrapWithPassphrase,
  wrapWithRecoveryKey,
  type KeyWrap,
} from '@/crypto/keys'
import { encryptPost } from '@/crypto/envelope'
import { formatRecoveryKey, generateRecoveryKey, parseRecoveryKey } from '@/crypto/recovery-key'
import { usePlatform } from '@/platform'
import { useUi } from '@/state/ui'
import { clearMemoryDrafts } from './draft-memory'
import {
  EncryptionAlreadyConfiguredError,
  EncryptionContext,
  EncryptionLockedError,
  type EncryptionContextValue,
  type EncryptionPhase,
  type CurrentSecret,
  type PreparedRotation,
  type PreparedSetup,
} from './encryption-context'
import { registerEncryptionForget } from './forget'

export const LOCK_AFTER_MS = 15 * 60 * 1000
const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const

type Runtime = {
  phase: EncryptionPhase
  keyId: string | null
  dataKey: CryptoKey | null
}

function asWrap(wrap: { kdf: string; iterations?: number; salt: string; info?: string; iv: string; wrapped: string }): KeyWrap {
  if (wrap.kdf === 'pbkdf2-sha256' && wrap.iterations != null) {
    return { kdf: 'pbkdf2-sha256', iterations: wrap.iterations, salt: wrap.salt, iv: wrap.iv, wrapped: wrap.wrapped }
  }
  if (wrap.kdf === 'hkdf-sha256' && wrap.info != null) {
    return { kdf: 'hkdf-sha256', info: wrap.info, salt: wrap.salt, iv: wrap.iv, wrapped: wrap.wrapped }
  }
  throw new EncryptionLockedError()
}

function scrubPlaintext() {
  clearMemoryDrafts()
  useUi.setState((state) => ({
    pendingPosts: state.pendingPosts.map((pending) =>
      pending.encrypted ? { ...pending, body: '' } : pending,
    ),
    failedEdits: Object.fromEntries(
      Object.entries(state.failedEdits).filter(([, failedEdit]) => !failedEdit.encrypted),
    ),
  }))
}

export function EncryptionProvider({
  children,
  now = () => Date.now(),
  lockAfterMs = LOCK_AFTER_MS,
  checkIntervalMs = 15_000,
}: {
  children: ReactNode
  now?: () => number
  lockAfterMs?: number
  checkIntervalMs?: number
}) {
  const { api, signedIn } = useAuth()
  const platform = usePlatform()
  const [phase, setPhase] = useState<EncryptionPhase>('loading')
  const [keyId, setKeyId] = useState<string | null>(null)
  const [dataKey, setDataKey] = useState<CryptoKey | null>(null)
  const [persisted, setPersisted] = useState(false)
  const [canPersist, setCanPersist] = useState(false)
  const [generation, setGeneration] = useState(0)
  const [promptNewPassphrase, setPromptNewPassphrase] = useState(false)
  const [setupConflict, setSetupConflict] = useState(false)
  const [dialog, setDialog] = useState<'setup' | 'unlock' | null>(null)
  const cache = useRef(new Map<string, string | null>())
  const runtime = useRef<Runtime>({ phase: 'loading', keyId: null, dataKey: null })
  const unlockWaiters = useRef<Array<(ok: boolean) => void>>([])
  const setupWaiters = useRef<Array<(ok: boolean) => void>>([])
  const passphraseWrap = useRef<KeyWrap | null>(null)
  const recoveryWrap = useRef<KeyWrap | null>(null)
  const session = useRef(0)

  const assign = useCallback((next: Runtime) => {
    runtime.current = next
    setPhase(next.phase)
    setKeyId(next.keyId)
    setDataKey(next.dataKey)
  }, [])

  const settle = (waiters: Array<(ok: boolean) => void>, ok: boolean) => {
    waiters.splice(0).forEach((resolve) => resolve(ok))
  }

  const lock = useCallback(async () => {
    cache.current.clear()
    await platform.encryptionKeyStore.clear()
    setPersisted(false)
    setPromptNewPassphrase(false)
    setGeneration((current) => current + 1)
    const id = runtime.current.keyId
    assign({ phase: id ? 'locked' : 'unconfigured', keyId: id, dataKey: null })
    scrubPlaintext()
    settle(unlockWaiters.current, false)
  }, [assign, platform])

  const forget = useCallback(async () => {
    session.current += 1
    cache.current.clear()
    passphraseWrap.current = null
    recoveryWrap.current = null
    await platform.encryptionKeyStore.clear()
    setPersisted(false)
    setPromptNewPassphrase(false)
    setSetupConflict(false)
    setDialog(null)
    setGeneration((current) => current + 1)
    assign({ phase: 'loading', keyId: null, dataKey: null })
    scrubPlaintext()
    settle(unlockWaiters.current, false)
    settle(setupWaiters.current, false)
  }, [assign, platform])

  const adopt = useCallback(async (master: Uint8Array, id: string, remember: boolean) => {
    try {
      const nextKey = await deriveDataKey(master, id)
      if (remember) {
        if (!(await platform.encryptionKeyStore.canPersist())) {
          throw new EncryptionLockedError()
        }
        await platform.encryptionKeyStore.save(id, master)
        setPersisted(true)
      } else {
        await platform.encryptionKeyStore.clear()
        setPersisted(false)
      }
      assign({ phase: 'unlocked', keyId: id, dataKey: nextKey })
    } finally {
      master.fill(0)
    }
  }, [assign, platform])

  useEffect(() => registerEncryptionForget(forget), [forget])

  useEffect(() => {
    if (!signedIn) return
    const ticket = session.current + 1
    session.current = ticket
    void (async () => {
      try {
        const [keyring, persistable] = await Promise.all([
          api.getEncryptionKeyring(),
          platform.encryptionKeyStore.canPersist(),
        ])
        if (session.current !== ticket) return
        setCanPersist(persistable)
        if (!keyring) {
          passphraseWrap.current = null
          recoveryWrap.current = null
          assign({ phase: 'unconfigured', keyId: null, dataKey: null })
          return
        }
        passphraseWrap.current = asWrap(keyring.passphraseWrap)
        recoveryWrap.current = asWrap(keyring.recoveryWrap)
        const remembered = await platform.encryptionKeyStore.load()
        if (session.current !== ticket) return
        if (remembered && remembered.keyId === keyring.keyId) {
          setPersisted(true)
          assign({ phase: 'unlocked', keyId: keyring.keyId, dataKey: remembered.dataKey })
          return
        }
        if (remembered) await platform.encryptionKeyStore.clear()
        if (session.current !== ticket) return
        assign({ phase: 'locked', keyId: keyring.keyId, dataKey: null })
      } catch (err) {
        if (session.current !== ticket || (err instanceof ApiError && err.code === 'account_not_allowed')) return
        assign({ phase: 'locked', keyId: null, dataKey: null })
      }
    })()
  }, [api, assign, platform, signedIn])

  // 記憶しない解錠だけ、操作が無いとロックする。バックグラウンドでタイマーが止まっても、
  // 画面に戻ったときに経過時間で判定する。
  useEffect(() => {
    if (phase !== 'unlocked' || persisted) return
    let last = now()
    const mark = () => {
      last = now()
    }
    const check = () => {
      if (now() - last >= lockAfterMs) void lock()
    }
    for (const event of ACTIVITY_EVENTS) window.addEventListener(event, mark, { capture: true })
    const onVisible = () => {
      if (document.visibilityState === 'visible') check()
    }
    document.addEventListener('visibilitychange', onVisible)
    const timer = window.setInterval(check, checkIntervalMs)
    return () => {
      for (const event of ACTIVITY_EVENTS) window.removeEventListener(event, mark, { capture: true })
      document.removeEventListener('visibilitychange', onVisible)
      window.clearInterval(timer)
    }
  }, [checkIntervalMs, lock, lockAfterMs, now, persisted, phase])

  const prepareSetup = useCallback(async (passphrase: string): Promise<PreparedSetup> => {
    const master = generateMasterKey()
    const recovery = generateRecoveryKey()
    const id = crypto.randomUUID()
    const nextPassphrase = await wrapWithPassphrase(master, passphrase, id)
    const nextRecovery = await wrapWithRecoveryKey(master, recovery, id)
    const keyProof = await deriveKeyProof(master, id)
    const recoveryKey = formatRecoveryKey(recovery)
    recovery.fill(0)
    let spent = false
    const release = () => {
      if (spent) return
      spent = true
      master.fill(0)
    }
    return {
      recoveryKey,
      discard: release,
      confirm: async () => {
        try {
          try {
            await api.createEncryptionKeyring({
              keyId: id,
              keyProof,
              passphraseWrap: nextPassphrase,
              recoveryWrap: nextRecovery,
            })
          } catch (err) {
            if (err instanceof ApiError && err.status === 409) {
              const existing = await api.getEncryptionKeyring()
              passphraseWrap.current = existing ? asWrap(existing.passphraseWrap) : null
              recoveryWrap.current = existing ? asWrap(existing.recoveryWrap) : null
              assign({ phase: 'locked', keyId: existing?.keyId ?? null, dataKey: null })
              setSetupConflict(true)
              setDialog('unlock')
              settle(setupWaiters.current, false)
              throw new EncryptionAlreadyConfiguredError()
            }
            throw err
          }
          passphraseWrap.current = nextPassphrase
          recoveryWrap.current = nextRecovery
          const unlocked = await deriveDataKey(master, id)
          setPersisted(false)
          setPromptNewPassphrase(false)
          assign({ phase: 'unlocked', keyId: id, dataKey: unlocked })
          setDialog(null)
          settle(setupWaiters.current, true)
        } finally {
          release()
        }
      },
    }
  }, [api, assign])

  const unlockWith = useCallback(async (secret: Parameters<typeof unwrapMasterKey>[1], remember: boolean) => {
    const id = runtime.current.keyId
    const wrap = secret.kind === 'passphrase' ? passphraseWrap.current : recoveryWrap.current
    if (!id || !wrap || runtime.current.phase === 'unconfigured') throw new EncryptionLockedError()
    const master = await unwrapMasterKey(wrap, secret, id)
    await adopt(master, id, remember)
    // 復旧キーで解錠したら、同じダイアログで新しいパスフレーズの設定へ進める。
    setPromptNewPassphrase(secret.kind === 'recovery')
    if (secret.kind !== 'recovery') setDialog(null)
    settle(unlockWaiters.current, true)
  }, [adopt])

  const unlockWithPassphrase = useCallback(
    (passphrase: string, remember: boolean) => unlockWith({ kind: 'passphrase', passphrase }, remember),
    [unlockWith],
  )
  const unlockWithRecoveryKey = useCallback(
    async (recoveryKey: string, remember: boolean) => {
      const parsed = parseRecoveryKey(recoveryKey)
      try {
        await unlockWith({ kind: 'recovery', recoveryKey: parsed }, remember)
      } finally {
        parsed.fill(0)
      }
    },
    [unlockWith],
  )

  const requestUnlock = useCallback(() => {
    if (runtime.current.phase === 'unlocked' && runtime.current.dataKey) return Promise.resolve(true)
    setDialog('unlock')
    return new Promise<boolean>((resolve) => unlockWaiters.current.push(resolve))
  }, [])

  const requestSetup = useCallback(() => {
    if (runtime.current.phase !== 'unconfigured') return Promise.resolve(runtime.current.phase === 'unlocked')
    setDialog('setup')
    return new Promise<boolean>((resolve) => setupWaiters.current.push(resolve))
  }, [])

  const cancelDialog = useCallback(() => {
    setDialog(null)
    settle(unlockWaiters.current, false)
    settle(setupWaiters.current, false)
  }, [])

  const encryptBody = useCallback(async (plaintext: string) => {
    const current = runtime.current
    if (!current.dataKey || !current.keyId) throw new EncryptionLockedError()
    return encryptPost(current.dataKey, current.keyId, plaintext)
  }, [])

  const unwrapCurrent = useCallback(async (current: CurrentSecret) => {
    const id = runtime.current.keyId
    const wrap = current.kind === 'passphrase' ? passphraseWrap.current : recoveryWrap.current
    if (!id || !wrap) throw new EncryptionLockedError()
    if (current.kind === 'passphrase') {
      return unwrapMasterKey(wrap, { kind: 'passphrase', passphrase: current.passphrase }, id)
    }
    const parsed = parseRecoveryKey(current.recoveryKey)
    try {
      return await unwrapMasterKey(wrap, { kind: 'recovery', recoveryKey: parsed }, id)
    } finally {
      parsed.fill(0)
    }
  }, [])

  const changePassphrase = useCallback(async (current: CurrentSecret, nextPassphrase: string) => {
    const id = runtime.current.keyId
    if (!id) throw new EncryptionLockedError()
    const master = await unwrapCurrent(current)
    try {
      const next = await wrapWithPassphrase(master, nextPassphrase, id)
      const proof = await deriveKeyProof(master, id)
      const updated = await api.replaceEncryptionKeyWrap('passphrase', next, proof)
      passphraseWrap.current = asWrap(updated.passphraseWrap)
      setPromptNewPassphrase(false)
    } finally {
      master.fill(0)
    }
  }, [api, unwrapCurrent])

  const prepareRecoveryRotation = useCallback(async (current: CurrentSecret): Promise<PreparedRotation> => {
    const id = runtime.current.keyId
    if (!id) throw new EncryptionLockedError()
    const master = await unwrapCurrent(current)
    const recovery = generateRecoveryKey()
    try {
      const next = await wrapWithRecoveryKey(master, recovery, id)
      const proof = await deriveKeyProof(master, id)
      const recoveryKey = formatRecoveryKey(recovery)
      let spent = false
      return {
        recoveryKey,
        discard: () => {
          spent = true
        },
        confirm: async () => {
          if (spent) return
          spent = true
          const updated = await api.replaceEncryptionKeyWrap('recovery', next, proof)
          recoveryWrap.current = asWrap(updated.recoveryWrap)
        },
      }
    } finally {
      master.fill(0)
      recovery.fill(0)
    }
  }, [api, unwrapCurrent])

  const value = useMemo<EncryptionContextValue>(() => ({
    phase,
    keyId,
    dataKey,
    generation,
    canPersist,
    persisted,
    promptNewPassphrase,
    setupConflict,
    dismissNewPassphrase: () => setPromptNewPassphrase(false),
    prepareSetup,
    unlockWithPassphrase,
    unlockWithRecoveryKey,
    requestUnlock,
    requestSetup,
    cancelDialog,
    dialog,
    lock,
    forget,
    encryptBody,
    cacheSlot: (ciphertext) => cache.current.get(ciphertext),
    rememberDecryption: (ciphertext, plaintext) => cache.current.set(ciphertext, plaintext),
    changePassphrase,
    prepareRecoveryRotation,
    openDialog: setDialog,
  }), [
    canPersist,
    cancelDialog,
    changePassphrase,
    dialog,
    encryptBody,
    dataKey,
    forget,
    generation,
    keyId,
    lock,
    persisted,
    phase,
    prepareRecoveryRotation,
    prepareSetup,
    promptNewPassphrase,
    requestSetup,
    setupConflict,
    requestUnlock,
    unlockWithPassphrase,
    unlockWithRecoveryKey,
  ])

  return <EncryptionContext.Provider value={value}>{children}</EncryptionContext.Provider>
}
