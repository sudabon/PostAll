import { act, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/api/client'
import { generateMasterKey, wrapWithPassphrase, wrapWithRecoveryKey } from '@/crypto/keys'
import { formatRecoveryKey, generateRecoveryKey } from '@/crypto/recovery-key'
import { PlatformProvider, createFakeAdapter, createMemoryKeyStore } from '@/platform'
import type { PlatformAdapter } from '@/platform'
import { useUi } from '@/state/ui'
import { readMemoryDraft, writeMemoryDraft } from './draft-memory'
import { EncryptionProvider, LOCK_AFTER_MS } from './encryption-provider'
import { useEncryption } from './encryption-context'

const auth = vi.hoisted(() => ({
  signedIn: true,
  api: {
    getEncryptionKeyring: vi.fn(),
    createEncryptionKeyring: vi.fn(),
    replaceEncryptionKeyWrap: vi.fn(),
  },
}))

vi.mock('@/auth/auth-context', () => ({
  useAuth: () => auth,
}))

const PASSPHRASE = 'correct horse battery staple'

async function keyringFor(passphrase: string) {
  const master = generateMasterKey()
  const recovery = generateRecoveryKey()
  const keyId = crypto.randomUUID()
  const passphraseWrap = await wrapWithPassphrase(master, passphrase, keyId, { iterations: 1_000 })
  const recoveryWrap = await wrapWithRecoveryKey(master, recovery, keyId)
  const formatted = formatRecoveryKey(recovery)
  master.fill(0)
  recovery.fill(0)
  return {
    keyId,
    passphraseWrap,
    recoveryWrap,
    createdAt: '2026-11-13T00:00:00Z',
    updatedAt: '2026-11-13T00:00:00Z',
    recoveryKey: formatted,
  }
}

function Probe() {
  const encryption = useEncryption()
  const [plain, setPlain] = useState('')
  return (
    <div>
      <p data-testid="phase">{encryption.phase}</p>
      <p data-testid="generation">{encryption.generation}</p>
      <p data-testid="persisted">{String(encryption.persisted)}</p>
      <p data-testid="conflict">{String(encryption.setupConflict)}</p>
      <p data-testid="prompt">{String(encryption.promptNewPassphrase)}</p>
      <button type="button" onClick={() => void encryption.unlockWithPassphrase(PASSPHRASE, false).catch(() => setPlain('failed'))}>
        解錠
      </button>
      <button type="button" onClick={() => void encryption.unlockWithPassphrase('wrong passphrase!!', false).catch(() => setPlain('failed'))}>
        誤った解錠
      </button>
      <button type="button" onClick={() => void encryption.unlockWithPassphrase(PASSPHRASE, true).catch(() => setPlain('failed'))}>
        記憶して解錠
      </button>
      <input data-testid="recovery-input" onChange={(event) => setPlain(event.target.value)} />
      <button type="button" onClick={() => void encryption.unlockWithRecoveryKey(plain, false).then(() => setPlain('recovered')).catch(() => setPlain('failed'))}>
        復旧キーで解錠
      </button>
      <button type="button" onClick={() => void encryption.lock()}>ロック</button>
      <button type="button" onClick={() => void encryption.forget()}>破棄</button>
      <button
        type="button"
        onClick={() => void encryption.encryptBody('秘匿メモ').then((ciphertext) => setPlain(ciphertext)).catch(() => setPlain('failed'))}
      >
        暗号化
      </button>
      <button
        type="button"
        onClick={() => {
          const sent: unknown[] = []
          void encryption.changePassphrase({ kind: 'passphrase', passphrase: PASSPHRASE }, 'a brand new passphrase')
            .then(() => setPlain('changed'))
            .catch(() => setPlain('failed'))
          void sent
        }}
      >
        パスフレーズ変更
      </button>
      <p data-testid="output">{plain}</p>
    </div>
  )
}

function renderProvider(adapter: PlatformAdapter, options: { lockAfterMs?: number; checkIntervalMs?: number; now?: () => number } = {}) {
  return render(
    <PlatformProvider adapter={adapter}>
      <EncryptionProvider {...options}>
        <Probe />
      </EncryptionProvider>
    </PlatformProvider>,
  )
}

beforeEach(() => {
  auth.signedIn = true
  auth.api.getEncryptionKeyring.mockReset()
  auth.api.createEncryptionKeyring.mockReset()
  auth.api.replaceEncryptionKeyWrap.mockReset()
  useUi.setState({ pendingPosts: [], editingPostId: null, failedEdits: {} })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('EncryptionProvider', () => {
  it('stays unconfigured until a keyring exists', async () => {
    auth.api.getEncryptionKeyring.mockResolvedValue(null)
    renderProvider(createFakeAdapter())
    expect(await screen.findByText('unconfigured')).toBeTruthy()
  })

  it('locks when a keyring exists and unlocks only with the passphrase', async () => {
    const keyring = await keyringFor(PASSPHRASE)
    auth.api.getEncryptionKeyring.mockResolvedValue(keyring)
    renderProvider(createFakeAdapter())
    expect(await screen.findByText('locked')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '誤った解錠' }))
    expect(await screen.findByText('failed')).toBeTruthy()
    expect(screen.getByTestId('phase')).toHaveTextContent('locked')

    fireEvent.click(screen.getByRole('button', { name: '解錠' }))
    expect(await screen.findByText('unlocked')).toBeTruthy()
    expect(screen.getByTestId('persisted')).toHaveTextContent('false')

    fireEvent.click(screen.getByRole('button', { name: '暗号化' }))
    const ciphertext = (await screen.findByText(/^pe1\./)).textContent!
    expect(ciphertext).not.toContain('秘匿メモ')
    expect(ciphertext.startsWith(`pe1.${keyring.keyId}.`)).toBe(true)
  })

  it('remembers the key only when asked, and lock or forget clears it', async () => {
    const keyring = await keyringFor(PASSPHRASE)
    auth.api.getEncryptionKeyring.mockResolvedValue(keyring)
    const store = createMemoryKeyStore()
    const { unmount } = renderProvider(createFakeAdapter({ encryptionKeyStore: store }))
    expect(await screen.findByText('locked')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '記憶して解錠' }))
    expect(await screen.findByText('unlocked')).toBeTruthy()
    expect(await store.load()).toMatchObject({ keyId: keyring.keyId })
    unmount()

    renderProvider(createFakeAdapter({ encryptionKeyStore: store }))
    expect(await screen.findByText('unlocked')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'ロック' }))
    expect(await screen.findByText('locked')).toBeTruthy()
    expect(await store.load()).toBeNull()
    expect(Number(screen.getByTestId('generation').textContent)).toBeGreaterThan(0)
  })

  it('drops encrypted plaintext from drafts, pending posts and failed edits when locking', async () => {
    const keyring = await keyringFor(PASSPHRASE)
    auth.api.getEncryptionKeyring.mockResolvedValue(keyring)
    writeMemoryDraft('draft:secret', '下書き')
    const failedEdit = { attachments: [], error: '保存に失敗しました', postUpdatedAt: '2026-11-13T00:00:00Z' }
    useUi.setState({
      failedEdits: {
        secret: { ...failedEdit, body: '保存できなかった秘密', encrypted: true },
        plain: { ...failedEdit, body: '平文チャネルの編集' },
      },
      pendingPosts: [{
        key: 'p1',
        channelId: 'c',
        threadRootId: null,
        body: '送信前',
        encrypted: true,
        ciphertext: 'pe1.kept',
        attachments: [],
        createdAt: '2026-11-13T00:00:00Z',
        status: 'sending',
      }],
    })
    renderProvider(createFakeAdapter())
    fireEvent.click(await screen.findByRole('button', { name: '解錠' }))
    expect(await screen.findByText('unlocked')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'ロック' }))
    expect(await screen.findByText('locked')).toBeTruthy()
    expect(readMemoryDraft('draft:secret')).toBe('')
    expect(useUi.getState().pendingPosts[0]).toMatchObject({ body: '', ciphertext: 'pe1.kept' })
    expect(Object.keys(useUi.getState().failedEdits)).toEqual(['plain'])
  })

  it('unlocks with the recovery key and prompts for a new passphrase', async () => {
    const keyring = await keyringFor(PASSPHRASE)
    auth.api.getEncryptionKeyring.mockResolvedValue(keyring)
    renderProvider(createFakeAdapter())
    expect(await screen.findByText('locked')).toBeTruthy()
    fireEvent.change(screen.getByTestId('recovery-input'), { target: { value: keyring.recoveryKey } })
    fireEvent.click(screen.getByRole('button', { name: '復旧キーで解錠' }))
    expect(await screen.findByText('recovered')).toBeTruthy()
    expect(screen.getByTestId('phase')).toHaveTextContent('unlocked')
    expect(screen.getByTestId('prompt')).toHaveTextContent('true')
  })

  it('replaces only the passphrase wrap and never sends the passphrase or the master key', async () => {
    const keyring = await keyringFor(PASSPHRASE)
    auth.api.getEncryptionKeyring.mockResolvedValue(keyring)
    auth.api.replaceEncryptionKeyWrap.mockImplementation(async (_kind: string, wrap: unknown) => ({
      ...keyring,
      passphraseWrap: wrap,
    }))
    renderProvider(createFakeAdapter())
    fireEvent.click(await screen.findByRole('button', { name: '解錠' }))
    expect(await screen.findByText('unlocked')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'パスフレーズ変更' }))
    expect(await screen.findByText('changed')).toBeTruthy()
    const [kind, wrap, proof] = auth.api.replaceEncryptionKeyWrap.mock.calls[0]
    expect(kind).toBe('passphrase')
    const body = JSON.stringify({ wrap, proof })
    expect(body).not.toContain(PASSPHRASE)
    expect(body).not.toContain('a brand new passphrase')
    expect(wrap).toMatchObject({ kdf: 'pbkdf2-sha256', iterations: 600000 })
  })

  it('does not replace an existing keyring when setup conflicts', async () => {
    auth.api.getEncryptionKeyring.mockResolvedValue(null)
    const existing = await keyringFor(PASSPHRASE)
    auth.api.createEncryptionKeyring.mockRejectedValue(new ApiError(409, {
      code: 'encryption_already_configured',
      message: '既に設定されています',
    }))
    auth.api.getEncryptionKeyring.mockResolvedValueOnce(null).mockResolvedValue(existing)
    function SetupProbe() {
      const encryption = useEncryption()
      return (
        <button
          type="button"
          onClick={() => void encryption.prepareSetup(PASSPHRASE).then((prepared) => prepared.confirm()).catch(() => undefined)}
        >
          初期設定
        </button>
      )
    }
    render(
      <PlatformProvider adapter={createFakeAdapter()}>
        <EncryptionProvider>
          <SetupProbe />
          <Probe />
        </EncryptionProvider>
      </PlatformProvider>,
    )
    expect(await screen.findByText('unconfigured')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '初期設定' }))
    expect(await screen.findByText('locked')).toBeTruthy()
    expect(screen.getByTestId('conflict')).toHaveTextContent('true')
    expect(auth.api.createEncryptionKeyring).toHaveBeenCalledTimes(1)
    const body = JSON.stringify(auth.api.createEncryptionKeyring.mock.calls[0][0])
    expect(body).not.toContain(PASSPHRASE)
  })

  it('locks after 15 idle minutes only when the key is not remembered', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const keyring = await keyringFor(PASSPHRASE)
    auth.api.getEncryptionKeyring.mockResolvedValue(keyring)
    renderProvider(createFakeAdapter(), { checkIntervalMs: 1_000 })
    expect(await screen.findByText('locked')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '解錠' }))
    expect(await screen.findByText('unlocked')).toBeTruthy()

    await act(() => vi.advanceTimersByTimeAsync(LOCK_AFTER_MS - 1_000))
    expect(screen.getByTestId('phase')).toHaveTextContent('unlocked')
    fireEvent.pointerDown(window)
    await act(() => vi.advanceTimersByTimeAsync(LOCK_AFTER_MS - 1_000))
    expect(screen.getByTestId('phase')).toHaveTextContent('unlocked')
    await act(() => vi.advanceTimersByTimeAsync(1_000))
    expect(screen.getByTestId('phase')).toHaveTextContent('locked')
  })

  it('locks when the page becomes visible after 15 idle minutes', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const keyring = await keyringFor(PASSPHRASE)
    auth.api.getEncryptionKeyring.mockResolvedValue(keyring)
    renderProvider(createFakeAdapter(), { checkIntervalMs: 60 * 60 * 1000 })
    fireEvent.click(await screen.findByRole('button', { name: '解錠' }))
    expect(await screen.findByText('unlocked')).toBeTruthy()

    await act(() => vi.advanceTimersByTimeAsync(LOCK_AFTER_MS))
    expect(screen.getByTestId('phase')).toHaveTextContent('unlocked')
    fireEvent(document, new Event('visibilitychange'))
    expect(screen.getByTestId('phase')).toHaveTextContent('locked')
  })
})
