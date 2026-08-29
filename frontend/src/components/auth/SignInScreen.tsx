import { useAuth } from '@/auth/AuthProvider'
import { Button } from '@/components/ui/button'
import { useSettings } from '@/state/settings'
import { useUi } from '@/state/ui'
import { isStandaloneDisplay } from '@/lib/standalone'

export function SignInScreen() {
  const { signIn, error } = useAuth()
  const settings = useSettings()
  const missing = !settings.supabaseUrl || !settings.supabasePublishableKey
  const standalone = isStandaloneDisplay()

  return (
    <main className="flex min-h-dvh items-center justify-center bg-background p-8 text-foreground">
      <section className="material-regular flex w-full max-w-md flex-col items-center gap-6 rounded-2xl border border-border p-8 text-center shadow-lg">
        <h1 className="text-display font-semibold text-balance">PostAll</h1>
        <p className="text-body text-pretty text-muted-foreground">サインインしてメモを開きます</p>
        {standalone ? (
          <p className="max-w-md text-pretty text-caption text-muted-foreground" data-testid="standalone-signin-note">
            ホーム画面のアプリと Safari ではサインイン状態が共有されません。途中で別のブラウザが開いた場合は、そちらで続けるか、ホーム画面のアプリに戻ってもう一度サインインしてください。
          </p>
        ) : null}
        {missing ? (
          <p className="max-w-md text-center text-body text-destructive">
            Supabase のプロジェクト URL と publishable key を設定してください。
          </p>
        ) : null}
        {error ? (
          <p className="max-w-md text-center text-body text-destructive" data-testid="auth-error">
            {error}
          </p>
        ) : null}
        <div className="flex gap-3">
          <Button data-testid="sign-in-button" type="button" onClick={() => void signIn()} disabled={missing}>
            サインイン
          </Button>
          <Button type="button" variant="outline" onClick={() => useUi.getState().setSettingsOpen(true)}>
            設定
          </Button>
        </div>
      </section>
    </main>
  )
}
