import { useEffect } from 'react'
import { useQueryClient, type QueryKey } from '@tanstack/react-query'
import type { ChangeEvent } from '@/api/client'
import { useAuth } from '@/auth/AuthProvider'
import { currentAccessToken } from '@/auth/session'
import { subscribePostallEvents } from '@/lib/realtime'
import { useSettings } from '@/state/settings'
import { useUi } from '@/state/ui'

const pollInterval = 15_000

export function useChangeSync(enabled = true) {
  const { api, signedIn } = useAuth()
  const queryClient = useQueryClient()
  const supabaseUrl = useSettings((s) => s.supabaseUrl)
  const publishableKey = useSettings((s) => s.supabasePublishableKey)

  useEffect(() => {
    if (!enabled || !signedIn) return
    let stopped = false
    let lastEventId: string | null = null
    let pollTimer: number | null = null
    let recovery: Promise<boolean> | null = null
    let unsubscribeRealtime: (() => void) | null = null
    const pendingInvalidations = new Map<string, QueryKey>()
    let invalidationQueued = false

    const flushInvalidations = () => {
      invalidationQueued = false
      const keys = [...pendingInvalidations.values()]
      pendingInvalidations.clear()
      for (const queryKey of keys) {
        void queryClient.invalidateQueries({ queryKey })
      }
    }

    const queueInvalidation = (key: string, queryKey: QueryKey) => {
      pendingInvalidations.set(key, queryKey)
      if (invalidationQueued) return
      invalidationQueued = true
      queueMicrotask(flushInvalidations)
    }

    const advanceCursor = (event: ChangeEvent): boolean => {
      if (!/^[0-9]+$/.test(event.id)) return false
      if (lastEventId !== null && BigInt(event.id) <= BigInt(lastEventId)) return false
      lastEventId = event.id
      return true
    }

    const applyEvent = (event: ChangeEvent) => {
      if (!advanceCursor(event)) return
      if (event.eventType.startsWith('channel.')) {
        queueInvalidation('channels', ['channels'])
        return
      }
      if (event.channelId) {
        queueInvalidation(`posts:${event.channelId}`, ['posts', event.channelId])
      }
      if (event.eventType.startsWith('reply.') && event.threadRootId) {
        queueInvalidation(`thread:${event.threadRootId}`, ['thread', event.threadRootId])
      }
      if (event.eventType === 'reaction.updated') {
        const threadId = event.threadRootId ?? event.postId
        if (threadId) queueInvalidation(`thread:${threadId}`, ['thread', threadId])
      }
    }

    const recoverChanges = async (): Promise<boolean> => {
      if (!navigator.onLine) {
        useUi.getState().setConnectionState('offline')
        return false
      }
      try {
        await api.getHealth()
      } catch {
        if (!stopped) useUi.getState().setConnectionState('offline')
        return false
      }
      if (stopped) return false
      try {
        let cursor = lastEventId ?? '0'
        while (!stopped) {
          const page = await api.listEvents(cursor, 200)
          for (const event of page.events) applyEvent(event)
          if (/^[0-9]+$/.test(page.nextAfter) && (lastEventId === null || BigInt(page.nextAfter) > BigInt(lastEventId))) {
            lastEventId = page.nextAfter
          }
          cursor = page.nextAfter
          if (!page.hasMore) break
        }
        if (!stopped) {
          await Promise.all([
            queryClient.invalidateQueries({ queryKey: ['channels'] }),
            queryClient.invalidateQueries({ queryKey: ['posts'] }),
            queryClient.invalidateQueries({ queryKey: ['thread'] }),
          ])
        }
        return !stopped
      } catch {
        return false
      }
    }

    const recoverOnce = () => {
      if (recovery) return recovery
      recovery = recoverChanges().finally(() => {
        recovery = null
      })
      return recovery
    }

    const startPolling = () => {
      if (pollTimer !== null) return
      pollTimer = window.setInterval(() => {
        void recoverOnce()
      }, pollInterval)
    }

    const stopPolling = () => {
      if (pollTimer === null) return
      window.clearInterval(pollTimer)
      pollTimer = null
    }

    const connectRealtime = () => {
      unsubscribeRealtime?.()
      if (!navigator.onLine) {
        useUi.getState().setConnectionState('offline')
        return
      }
      useUi.getState().setConnectionState('connecting')
      const token = currentAccessToken()
      unsubscribeRealtime = subscribePostallEvents({
        supabaseUrl,
        publishableKey,
        accessToken: token ?? '',
        onSignal: () => {
          void recoverOnce()
        },
        onStatus: (subscribed) => {
          if (stopped) return
          if (subscribed) {
            stopPolling()
            useUi.getState().setConnectionState('live')
            void recoverOnce()
            return
          }
          useUi.getState().setConnectionState('degraded')
          startPolling()
          void recoverOnce()
        },
      })
    }

    const refreshNow = () => {
      if (stopped) return
      void recoverOnce()
    }
    const onOnline = () => {
      connectRealtime()
    }
    const onOffline = () => {
      useUi.getState().setConnectionState('offline')
      unsubscribeRealtime?.()
      stopPolling()
    }
    const onVisibility = () => {
      if (document.visibilityState === 'visible') refreshNow()
    }
    const onMockSignal = () => {
      void recoverOnce()
    }
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('postall:change-signal', onMockSignal)
    connectRealtime()

    return () => {
      stopped = true
      unsubscribeRealtime?.()
      stopPolling()
      pendingInvalidations.clear()
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('postall:change-signal', onMockSignal)
    }
  }, [api, enabled, publishableKey, queryClient, signedIn, supabaseUrl])
}
