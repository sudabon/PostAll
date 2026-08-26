import { createClient } from '@supabase/supabase-js'

export function subscribePostallEvents(input: {
  supabaseUrl: string
  publishableKey: string
  accessToken: string
  onSignal: () => void
  onStatus: (subscribed: boolean) => void
}): () => void {
  if (!input.supabaseUrl || !input.publishableKey || !input.accessToken) {
    input.onStatus(false)
    return () => {}
  }

  const client = createClient(input.supabaseUrl, input.publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${input.accessToken}` } },
  })
  void client.realtime.setAuth(input.accessToken)
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
