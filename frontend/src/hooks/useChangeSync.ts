import { useEffect } from 'react'
import { useQueryClient, type QueryKey } from '@tanstack/react-query'
import type { ChangeEvent } from '@/api/client'
import { parseSseStream } from '@/api/sse'
import { useAuth } from '@/auth/AuthProvider'
import { useUi } from '@/state/ui'

const firstReconnectDelay = 1_000
const maxReconnectDelay = 30_000

export function useChangeSync(enabled = true) {
  const { api, signedIn } = useAuth()
  const queryClient = useQueryClient()

  useEffect(() => {
    if (!enabled || !signedIn) return
    let stopped = false
    let lastEventId: string | null = null
    let streamController: AbortController | null = null
    let reconnectTimer: number | null = null
    let wakeReconnect: (() => void) | null = null
    let recovery: Promise<boolean> | null = null
    let reconnectImmediately = false
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

    const applySyncWatermark = (event: ChangeEvent) => {
      if (event.channelId || event.postId || event.threadRootId || !advanceCursor(event)) return
      queueInvalidation('channels', ['channels'])
      queueInvalidation('posts', ['posts'])
      queueInvalidation('thread', ['thread'])
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
      useUi.getState().setConnectionState('degraded')
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

    const waitBeforeReconnect = (delay: number) => new Promise<void>((resolve) => {
      wakeReconnect = () => {
        if (reconnectTimer !== null) window.clearTimeout(reconnectTimer)
        reconnectTimer = null
        wakeReconnect = null
        resolve()
      }
      reconnectTimer = window.setTimeout(() => wakeReconnect?.(), delay)
    })

    const run = async () => {
      let delay = firstReconnectDelay
      useUi.getState().setConnectionState('connecting')
      while (!stopped) {
        if (recovery) await recovery
        reconnectImmediately = false
        if (!navigator.onLine) {
          useUi.getState().setConnectionState('offline')
          await waitBeforeReconnect(delay)
          delay = Math.min(delay * 2, maxReconnectDelay)
          continue
        }
        streamController = new AbortController()
        try {
          const stream = await api.streamEvents(lastEventId, streamController.signal)
          if (stopped) return
          useUi.getState().setConnectionState('live')
          delay = firstReconnectDelay
          await parseSseStream(stream, (message) => {
            try {
              const event = JSON.parse(message.data) as ChangeEvent
              if (message.id && message.id !== event.id) return
              if (message.event === 'postall.sync') {
                applySyncWatermark(event)
                return
              }
              applyEvent(event)
            } catch {
              // Ignore one malformed frame and keep the durable stream alive.
            }
          }, streamController.signal)
          if (stopped) return
        } catch {
          if (stopped) return
        }
        await recoverOnce()
        if (stopped) return
        if (reconnectImmediately) continue
        await waitBeforeReconnect(delay)
        delay = Math.min(delay * 2, maxReconnectDelay)
      }
    }

    const refreshNow = () => {
      if (stopped) return
      reconnectImmediately = true
      wakeReconnect?.()
      void recoverOnce().finally(() => {
        if (!stopped) streamController?.abort()
      })
    }
    const onOnline = () => refreshNow()
    const onOffline = () => {
      useUi.getState().setConnectionState('offline')
      streamController?.abort()
    }
    const onVisibility = () => {
      if (document.visibilityState === 'visible') refreshNow()
    }
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    document.addEventListener('visibilitychange', onVisibility)
    void run()

    return () => {
      stopped = true
      streamController?.abort()
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer)
      wakeReconnect?.()
      pendingInvalidations.clear()
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [api, enabled, queryClient, signedIn])
}
