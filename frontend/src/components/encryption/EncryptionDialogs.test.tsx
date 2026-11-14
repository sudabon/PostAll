import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/api/client'
import { generateMasterKey, wrapWithPassphrase, wrapWithRecoveryKey } from '@/crypto/keys'
import { generateRecoveryKey } from '@/crypto/recovery-key'
import { EncryptionDialogs } from '@/components/encryption/EncryptionDialogs'
import { useEncryption } from '@/encryption/encryption-context'
import { EncryptionProvider } from '@/encryption/encryption-provider'
import { PlatformProvider, createFakeAdapter } from '@/platform'
import { MotionTestProvider } from '@/test/motion'

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

function Open({ dialog }: { dialog: 'setup' | 'unlock' }) {
  const encryption = useEncryption()
  return (
    <>
      <p data-testid="phase">{encryption.phase}</p>
      <p data-testid="dialog">{encryption.dialog ?? 'none'}</p>
      <button type="button" onClick={() => encryption.openDialog(dialog)}>
        開く
      </button>
    </>
  )
}

function renderDialog(dialog: 'setup' | 'unlock') {
  return render(
    <MotionTestProvider>
      <PlatformProvider adapter={createFakeAdapter()}>
        <EncryptionProvider>
          <Open dialog={dialog} />
          <EncryptionDialogs />
        </EncryptionProvider>
      </PlatformProvider>
    </MotionTestProvider>,
  )
}

beforeEach(() => {
  auth.api.getEncryptionKeyring.mockReset()
  auth.api.createEncryptionKeyring.mockReset()
  auth.api.getEncryptionKeyring.mockResolvedValue(null)
})

describe('SetupEncryptionDialog', () => {
  it('does not continue with a short passphrase or without confirming the recovery key', async () => {
    renderDialog('setup')
    expect(await screen.findByTestId('phase')).toHaveTextContent('unconfigured')
    fireEvent.click(screen.getByRole('button', { name: '開く' }))
    fireEvent.change(screen.getByTestId('setup-passphrase'), { target: { value: 'short-pass' } })
    fireEvent.change(screen.getByTestId('setup-passphrase-confirm'), { target: { value: 'short-pass' } })
    expect(screen.getByTestId('setup-continue')).toBeDisabled()
    expect(screen.getByText('パスフレーズは 12 文字以上にしてください')).toBeTruthy()
    expect(auth.api.createEncryptionKeyring).not.toHaveBeenCalled()

    fireEvent.change(screen.getByTestId('setup-passphrase'), { target: { value: PASSPHRASE } })
    fireEvent.change(screen.getByTestId('setup-passphrase-confirm'), { target: { value: PASSPHRASE } })
    fireEvent.click(screen.getByTestId('setup-continue'))
    expect(await screen.findByTestId('setup-recovery-key')).toBeTruthy()
    expect(screen.getByTestId('setup-finish')).toBeDisabled()
    expect(auth.api.createEncryptionKeyring).not.toHaveBeenCalled()
  })

  it('switches to unlock without replacing the keyring when setup conflicts', async () => {
    const master = generateMasterKey()
    const recovery = generateRecoveryKey()
    const keyId = crypto.randomUUID()
    const existing = {
      keyId,
      passphraseWrap: await wrapWithPassphrase(master, PASSPHRASE, keyId, { iterations: 1_000 }),
      recoveryWrap: await wrapWithRecoveryKey(master, recovery, keyId),
      createdAt: '2026-11-13T00:00:00Z',
      updatedAt: '2026-11-13T00:00:00Z',
    }
    master.fill(0)
    recovery.fill(0)
    auth.api.createEncryptionKeyring.mockRejectedValue(new ApiError(409, {
      code: 'encryption_already_configured',
      message: '既に設定されています',
    }))
    auth.api.getEncryptionKeyring.mockResolvedValueOnce(null).mockResolvedValue(existing)
    renderDialog('setup')
    expect(await screen.findByTestId('phase')).toHaveTextContent('unconfigured')
    fireEvent.click(screen.getByRole('button', { name: '開く' }))
    fireEvent.change(screen.getByTestId('setup-passphrase'), { target: { value: PASSPHRASE } })
    fireEvent.change(screen.getByTestId('setup-passphrase-confirm'), { target: { value: PASSPHRASE } })
    fireEvent.click(screen.getByTestId('setup-continue'))
    fireEvent.click(await screen.findByTestId('setup-recovery-ack'))
    fireEvent.click(screen.getByTestId('setup-finish'))
    expect(await screen.findByTestId('setup-conflict')).toHaveTextContent('置き換えません')
    expect(screen.getByTestId('encryption-unlock')).toBeTruthy()
    expect(auth.api.createEncryptionKeyring).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(auth.api.createEncryptionKeyring.mock.calls)).not.toContain(PASSPHRASE)
  })
})

describe('UnlockEncryptionDialog', () => {
  it('stays locked on a wrong passphrase and prompts for a new one after the recovery key', async () => {
    const master = generateMasterKey()
    const recovery = generateRecoveryKey()
    const keyId = crypto.randomUUID()
    const formatted = (await import('@/crypto/recovery-key')).formatRecoveryKey(recovery)
    auth.api.getEncryptionKeyring.mockResolvedValue({
      keyId,
      passphraseWrap: await wrapWithPassphrase(master, PASSPHRASE, keyId, { iterations: 1_000 }),
      recoveryWrap: await wrapWithRecoveryKey(master, recovery, keyId),
      createdAt: '2026-11-13T00:00:00Z',
      updatedAt: '2026-11-13T00:00:00Z',
    })
    master.fill(0)
    recovery.fill(0)
    renderDialog('unlock')
    expect(await screen.findByTestId('phase')).toHaveTextContent('locked')
    fireEvent.click(screen.getByRole('button', { name: '開く' }))
    fireEvent.change(await screen.findByTestId('unlock-secret'), { target: { value: 'wrong passphrase' } })
    fireEvent.click(screen.getByTestId('unlock-submit'))
    expect(await screen.findByTestId('unlock-error')).toHaveTextContent('解錠できませんでした')
    expect(screen.queryByTestId('new-passphrase-prompt')).toBeNull()

    fireEvent.click(screen.getByTestId('unlock-use-recovery'))
    fireEvent.change(screen.getByTestId('unlock-secret'), { target: { value: formatted } })
    fireEvent.click(screen.getByTestId('unlock-submit'))
    expect(await screen.findByTestId('new-passphrase-prompt')).toHaveTextContent('新しいパスフレーズ')
    // 閉じる途中に一瞬出るのではなく、ダイアログを開いたまま設定へ進める。
    expect(screen.getByTestId('phase')).toHaveTextContent('unlocked')
    expect(screen.getByTestId('dialog')).toHaveTextContent('unlock')
  })
})
