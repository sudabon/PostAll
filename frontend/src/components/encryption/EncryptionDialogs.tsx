import { useState } from 'react'
import { KeyRound } from 'lucide-react'
import { AnimatePresence, m } from 'motion/react'
import { Button } from '@/components/ui/button'
import {
  EncryptionAlreadyConfiguredError,
  useEncryptionOptional,
  type CurrentSecret,
} from '@/encryption/encryption-context'
import { MIN_PASSPHRASE_LENGTH, UnwrapError, passphraseLength } from '@/crypto/keys'
import { InvalidRecoveryKeyError } from '@/crypto/recovery-key'
import { useOverlayPresence } from '@/lib/motion/useOverlayPresence'

const fieldClass =
  'mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-body focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring'

export function EncryptionDialogs() {
  const encryption = useEncryptionOptional()
  const open = encryption?.dialog != null
  const onClose = () => encryption?.cancelDialog()
  const { dialogRef, shouldRender, isPresent, onCancel, onExitComplete, motionProps } = useOverlayPresence({
    open,
    onClose,
  })
  if (!encryption || !shouldRender) return null
  const title = encryption.dialog === 'setup' ? '暗号化の初期設定' : '暗号化チャネルの解錠'
  return (
    <dialog
      ref={dialogRef}
      className="m-auto h-dvh max-h-none w-dvw max-w-none overflow-visible border-0 bg-transparent p-0 text-foreground backdrop:bg-transparent"
      aria-labelledby="encryption-dialog-title"
      data-testid="encryption-dialog"
      onCancel={onCancel}
    >
      <AnimatePresence onExitComplete={onExitComplete}>
        {isPresent ? (
          <m.div
            key="encryption-overlay"
            {...motionProps.backdrop}
            className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/30 p-4"
          >
            <m.div
              {...motionProps.surface}
              className="material-thick w-full max-w-md rounded-xl border border-border p-6 text-foreground shadow-lg"
            >
              <h2 id="encryption-dialog-title" className="mb-1 flex items-center gap-2 text-heading font-semibold">
                <KeyRound className="size-5" aria-hidden="true" />
                {title}
              </h2>
              {encryption.dialog === 'setup' ? <SetupForm /> : <UnlockForm />}
            </m.div>
          </m.div>
        ) : null}
      </AnimatePresence>
    </dialog>
  )
}

function SetupForm() {
  const encryption = useEncryptionOptional()!
  const [passphrase, setPassphrase] = useState('')
  const [confirm, setConfirm] = useState('')
  const [recoveryKey, setRecoveryKey] = useState<string | null>(null)
  const [acked, setAcked] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const longEnough = passphraseLength(passphrase) >= MIN_PASSPHRASE_LENGTH
  const matches = passphrase === confirm

  const reveal = async () => {
    if (!longEnough || !matches) return
    setBusy(true)
    setError(null)
    try {
      const prepared = await encryption.prepareSetup(passphrase)
      setRecoveryKey(prepared.recoveryKey)
      const finish = prepared
      setPrepared(finish)
    } catch (err) {
      setError(err instanceof Error ? err.message : '初期設定を始められませんでした')
    } finally {
      setBusy(false)
    }
  }

  const [prepared, setPrepared] = useState<Awaited<ReturnType<typeof encryption.prepareSetup>> | null>(null)

  const finish = async () => {
    if (!prepared || !acked) return
    setBusy(true)
    setError(null)
    try {
      await prepared.confirm()
    } catch (err) {
      if (err instanceof EncryptionAlreadyConfiguredError) {
        setError('別の端末で初期設定が完了しています。パスフレーズで解錠してください。')
        return
      }
      setError(err instanceof Error ? err.message : '初期設定を完了できませんでした')
    } finally {
      setBusy(false)
    }
  }

  if (encryption.dialog === 'unlock') return <UnlockForm />

  if (!recoveryKey) {
    return (
      <form
        data-testid="encryption-setup"
        onSubmit={(event) => {
          event.preventDefault()
          void reveal()
        }}
      >
        <p className="mb-3 text-body text-muted-foreground">
          パスフレーズは 12 文字以上にしてください。復旧キーは次の画面で一度だけ表示します。
        </p>
        <label className="mb-3 block text-body">
          パスフレーズ
          <input
            type="password"
            autoFocus
            className={fieldClass}
            data-testid="setup-passphrase"
            value={passphrase}
            onChange={(event) => setPassphrase(event.target.value)}
          />
        </label>
        <label className="mb-3 block text-body">
          パスフレーズ（確認）
          <input
            type="password"
            className={fieldClass}
            data-testid="setup-passphrase-confirm"
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
          />
        </label>
        {passphrase && !longEnough ? (
          <p role="alert" className="mb-2 text-caption text-destructive">パスフレーズは 12 文字以上にしてください</p>
        ) : null}
        {confirm && !matches ? (
          <p role="alert" className="mb-2 text-caption text-destructive">パスフレーズが一致しません</p>
        ) : null}
        {error ? <p role="alert" className="mb-2 text-caption text-destructive">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => encryption.cancelDialog()}>キャンセル</Button>
          <Button type="submit" data-testid="setup-continue" disabled={!longEnough || !matches || busy}>次へ</Button>
        </div>
      </form>
    )
  }

  return (
    <form
      data-testid="encryption-setup-recovery"
      onSubmit={(event) => {
        event.preventDefault()
        void finish()
      }}
    >
      <p className="mb-2 text-body">この復旧キーを、別々の場所に 2 つ保管してください。この画面のあとでは再表示できません。</p>
      <p className="mb-3 break-all rounded-lg bg-muted px-3 py-2 font-mono text-body" data-testid="setup-recovery-key">{recoveryKey}</p>
      <label className="mb-3 flex items-start gap-2 text-body">
        <input
          type="checkbox"
          className="mt-1"
          data-testid="setup-recovery-ack"
          checked={acked}
          onChange={(event) => setAcked(event.target.checked)}
        />
        復旧キーを保管しました
      </label>
      {error ? <p role="alert" className="mb-2 text-caption text-destructive">{error}</p> : null}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={() => { prepared?.discard(); encryption.cancelDialog() }}>キャンセル</Button>
        <Button type="submit" data-testid="setup-finish" disabled={!acked || busy}>初期設定を完了</Button>
      </div>
    </form>
  )
}

function UnlockForm() {
  const encryption = useEncryptionOptional()!
  const [mode, setMode] = useState<'passphrase' | 'recovery'>('passphrase')
  const [secret, setSecret] = useState('')
  const [remember, setRemember] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [nextPassphrase, setNextPassphrase] = useState('')
  const [nextConfirm, setNextConfirm] = useState('')

  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      if (mode === 'passphrase') await encryption.unlockWithPassphrase(secret, remember && encryption.canPersist)
      else await encryption.unlockWithRecoveryKey(secret, remember && encryption.canPersist)
    } catch (err) {
      if (err instanceof UnwrapError || err instanceof InvalidRecoveryKeyError) {
        setError('解錠できませんでした。パスフレーズか復旧キーを確認してください。')
      } else {
        setError(err instanceof Error ? err.message : '解錠できませんでした')
      }
    } finally {
      setBusy(false)
    }
  }

  if (encryption.promptNewPassphrase && encryption.phase === 'unlocked') {
    return (
      <form
        data-testid="new-passphrase-prompt"
        onSubmit={(event) => {
          event.preventDefault()
          if (passphraseLength(nextPassphrase) < MIN_PASSPHRASE_LENGTH || nextPassphrase !== nextConfirm) return
          setBusy(true)
          void encryption.changePassphrase({ kind: 'recovery', recoveryKey: secret }, nextPassphrase)
            .then(() => encryption.cancelDialog())
            .catch((err: unknown) => setError(err instanceof Error ? err.message : '変更できませんでした'))
            .finally(() => setBusy(false))
        }}
      >
        <p className="mb-3 text-body">復旧キーで解錠しました。新しいパスフレーズを設定してください。</p>
        <label className="mb-3 block text-body">
          新しいパスフレーズ
          <input type="password" className={fieldClass} data-testid="new-passphrase" value={nextPassphrase} onChange={(event) => setNextPassphrase(event.target.value)} />
        </label>
        <label className="mb-3 block text-body">
          新しいパスフレーズ（確認）
          <input type="password" className={fieldClass} data-testid="new-passphrase-confirm" value={nextConfirm} onChange={(event) => setNextConfirm(event.target.value)} />
        </label>
        {error ? <p role="alert" className="mb-2 text-caption text-destructive">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => encryption.cancelDialog()}>あとで</Button>
          <Button type="submit" disabled={busy || passphraseLength(nextPassphrase) < MIN_PASSPHRASE_LENGTH || nextPassphrase !== nextConfirm}>設定する</Button>
        </div>
      </form>
    )
  }

  return (
    <form
      data-testid="encryption-unlock"
      onSubmit={(event) => {
        event.preventDefault()
        void submit()
      }}
    >
      {encryption.setupConflict ? (
        <p role="alert" className="mb-3 text-body" data-testid="setup-conflict">
          別の端末で初期設定が完了しています。既存の鍵は置き換えません。パスフレーズで解錠してください。
        </p>
      ) : null}
      <div className="mb-3 flex gap-2 text-body">
        <Button type="button" variant={mode === 'passphrase' ? 'default' : 'outline'} size="sm" onClick={() => setMode('passphrase')}>パスフレーズ</Button>
        <Button type="button" variant={mode === 'recovery' ? 'default' : 'outline'} size="sm" data-testid="unlock-use-recovery" onClick={() => setMode('recovery')}>復旧キー</Button>
      </div>
      <label className="mb-3 block text-body">
        {mode === 'passphrase' ? 'パスフレーズ' : '復旧キー'}
        <input
          autoFocus
          type={mode === 'passphrase' ? 'password' : 'text'}
          className={fieldClass}
          data-testid="unlock-secret"
          value={secret}
          onChange={(event) => setSecret(event.target.value)}
        />
      </label>
      <label className="mb-3 flex items-start gap-2 text-body">
        <input
          type="checkbox"
          className="mt-1"
          data-testid="unlock-remember"
          checked={remember}
          disabled={!encryption.canPersist}
          onChange={(event) => setRemember(event.target.checked)}
        />
        <span>
          この端末で記憶する
          {!encryption.canPersist ? <span className="mt-1 block text-caption text-muted-foreground" data-testid="unlock-remember-unavailable">この端末では鍵を安全に記憶できません</span> : null}
        </span>
      </label>
      {error ? <p role="alert" className="mb-2 text-caption text-destructive" data-testid="unlock-error">{error}</p> : null}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={() => encryption.cancelDialog()}>キャンセル</Button>
        <Button type="submit" data-testid="unlock-submit" disabled={!secret.trim() || busy}>解錠</Button>
      </div>
    </form>
  )
}

export function SecretFields({
  value,
  onChange,
}: {
  value: CurrentSecret
  onChange: (next: CurrentSecret) => void
}) {
  const recovery = value.kind === 'recovery'
  return (
    <label className="mb-3 block text-body">
      {recovery ? '復旧キー' : '現在のパスフレーズ'}
      <input
        type={recovery ? 'text' : 'password'}
        className={fieldClass}
        data-testid="current-secret"
        value={recovery ? value.recoveryKey : value.passphrase}
        onChange={(event) => onChange(recovery
          ? { kind: 'recovery', recoveryKey: event.target.value }
          : { kind: 'passphrase', passphrase: event.target.value })}
      />
    </label>
  )
}
