import { createClient } from '@supabase/supabase-js'

export function subscribePostallEvents(input: {
  supabaseUrl: string
  publishableKey: string
  accessToken?: string
  getAccessToken?: () => Promise<string | null>
  onSignal: () => void
  onStatus: (subscribed: boolean) => void
}): () => void {
  if (!input.supabaseUrl || !input.publishableKey || (!input.getAccessToken && !input.accessToken)) {
    input.onStatus(false)
    return () => {}
  }

  const getAccessToken = input.getAccessToken ?? (async () => input.accessToken ?? null)
  const client = createClient(input.supabaseUrl, input.publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    accessToken: getAccessToken,
  })
  const channel = client.channel('postall:events', { config: { private: true } })
  channel.on('broadcast', { event: 'change' }, () => {
    input.onSignal()
  })
  channel.subscribe((status) => {
    input.onStatus(status === 'SUBSCRIBED')
  })
  return () => {
    void client.removeChannel(channel)
  }
}
