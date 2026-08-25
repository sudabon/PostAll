import { useAuth } from '@/auth/AuthProvider'
import { Button } from '@/components/ui/button'
import { useSettings } from '@/state/settings'
import { useUi } from '@/state/ui'

export function SignInScreen() {
  const { signIn } = useAuth()
  const settings = useSettings()
  const missing = !settings.cognitoDomain || !settings.cognitoClientId

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background p-8 text-foreground">
      <h1 className="text-3xl font-semibold tracking-tight">PostAll</h1>
      <p className="text-muted-foreground">サインインしてメモを開きます</p>
      {missing ? (
        <p className="max-w-md text-center text-sm text-destructive">
          Cognito のドメインとクライアント ID を設定してください。
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
    </main>
  )
}
