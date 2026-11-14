import { useState } from 'react'
import { Lock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { SecretFields } from '@/components/encryption/EncryptionDialogs'
import { useEncryptionOptional, type CurrentSecret } from '@/encryption/encryption-context'
import { MIN_PASSPHRASE_LENGTH, passphraseLength } from '@/crypto/keys'

const fieldClass =
  'mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-body focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring'

/** 設定画面の、ロック・パスフレーズ変更・復旧キー再発行。 */
export function EncryptionSettings() {
  const encryption = useEncryptionOptional()
  const [mode, setMode] = useState<'idle' | 'passphrase' | 'recovery'>('idle')
  const [current, setCurrent] = useState<CurrentSecret>({ kind: 'passphrase', passphrase: '' })
  const [nextPassphrase, setNextPassphrase] = useState('')
  const [confirm, setConfirm] = useState('')
  const [recoveryKey, setRecoveryKey] = useState<string | null>(null)
  const [acked, setAcked] = useState(false)
  const [prepared, setPrepared] = useState<Awaited<ReturnType<NonNullable<typeof encryption>['prepareRecoveryRotation']>> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  if (!encryption || encryption.phase === 'loading' || encryption.phase === 'unconfigured') return null

  const reset = () => {
    prepared?.discard()
    setMode('idle')
    setCurrent({ kind: 'passphrase', passphrase: '' })
    setNextPassphrase('')
    setConfirm('')
    setRecoveryKey(null)
    setAcked(false)
    setPrepared(null)
    setError(null)
  }

  return (
    <section className="mb-4 rounded-lg border border-border p-3" data-testid="encryption-settings">
      <h3 className="mb-2 text-body font-semibold">暗号化</h3>
      {encryption.phase === 'locked' ? (
        <Button type="button" variant="outline" data-testid="encryption-settings-unlock" onClick={() => void encryption.requestUnlock()}>
          解錠する
        </Button>
      ) : (
        <div className="space-y-2">
          <Button
            type="button"
            variant="outline"
            data-testid="encryption-lock"
            onClick={() => void encryption.lock()}
          >
            <Lock className="size-4" aria-hidden="true" />
            ロック
          </Button>
          {mode === 'idle' ? (
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="ghost" data-testid="encryption-change-passphrase" onClick={() => setMode('passphrase')}>
                パスフレーズを変更
              </Button>
              <Button type="button" variant="ghost" data-testid="encryption-rotate-recovery" onClick={() => setMode('recovery')}>
                復旧キーを再発行
              </Button>
            </div>
          ) : null}
          {mode === 'passphrase' ? (
            <form
              data-testid="change-passphrase-form"
              onSubmit={(event) => {
                event.preventDefault()
                if (passphraseLength(nextPassphrase) < MIN_PASSPHRASE_LENGTH || nextPassphrase !== confirm) return
                setBusy(true)
                setError(null)
                void encryption.changePassphrase(current, nextPassphrase)
                  .then(reset)
                  .catch((err: unknown) => setError(err instanceof Error ? err.message : '変更できませんでした'))
                  .finally(() => setBusy(false))
              }}
            >
              <SecretFields value={current} onChange={setCurrent} />
              <label className="mb-3 block text-body">
                新しいパスフレーズ
                <input type="password" className={fieldClass} data-testid="next-passphrase" value={nextPassphrase} onChange={(event) => setNextPassphrase(event.target.value)} />
              </label>
              <label className="mb-3 block text-body">
                新しいパスフレーズ（確認）
                <input type="password" className={fieldClass} data-testid="next-passphrase-confirm" value={confirm} onChange={(event) => setConfirm(event.target.value)} />
              </label>
              {error ? <p role="alert" className="mb-2 text-caption text-destructive">{error}</p> : null}
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={reset}>キャンセル</Button>
                <Button type="submit" data-testid="change-passphrase-submit" disabled={busy}>変更する</Button>
              </div>
            </form>
          ) : null}
          {mode === 'recovery' ? (
            <form
              data-testid="rotate-recovery-form"
              onSubmit={(event) => {
                event.preventDefault()
                setBusy(true)
                setError(null)
                if (!prepared) {
                  void encryption.prepareRecoveryRotation(current)
                    .then((next) => {
                      setPrepared(next)
                      setRecoveryKey(next.recoveryKey)
                    })
                    .catch((err: unknown) => setError(err instanceof Error ? err.message : '再発行できませんでした'))
                    .finally(() => setBusy(false))
                  return
                }
                if (!acked) {
                  setBusy(false)
                  return
                }
                void prepared.confirm().then(reset).catch((err: unknown) => {
                  setError(err instanceof Error ? err.message : '再発行できませんでした')
                  setBusy(false)
                })
              }}
            >
              {recoveryKey ? (
                <>
                  <p className="mb-2 text-body">新しい復旧キーを 2 か所に保管してください。古い復旧キーでは解錠できなくなります。</p>
                  <p className="mb-3 break-all rounded-lg bg-muted px-3 py-2 font-mono text-body" data-testid="rotated-recovery-key">{recoveryKey}</p>
                  <label className="mb-3 flex items-start gap-2 text-body">
                    <input type="checkbox" data-testid="rotated-recovery-ack" checked={acked} onChange={(event) => setAcked(event.target.checked)} />
                    新しい復旧キーを保管しました
                  </label>
                </>
              ) : (
                <SecretFields value={current} onChange={setCurrent} />
              )}
              {error ? <p role="alert" className="mb-2 text-caption text-destructive">{error}</p> : null}
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={reset}>キャンセル</Button>
                <Button type="submit" data-testid="rotate-recovery-submit" disabled={busy || (recoveryKey !== null && !acked)}>
                  {recoveryKey ? '再発行を確定' : '再発行する'}
                </Button>
              </div>
            </form>
          ) : null}
        </div>
      )}
    </section>
  )
}
