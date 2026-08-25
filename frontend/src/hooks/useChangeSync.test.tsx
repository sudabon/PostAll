import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChangeEvent } from '@/api/client'
import { useUi } from '@/state/ui'
import { useChangeSync } from './useChangeSync'

const mocks = vi.hoisted(() => ({
  streamEvents: vi.fn(),
  listEvents: vi.fn(),
  getHealth: vi.fn(),
}))

vi.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({
    api: mocks,
    signedIn: true,
  }),
}))

beforeEach(() => {
  mocks.streamEvents.mockReset()
  mocks.listEvents.mockReset()
  mocks.getHealth.mockReset()
  useUi.getState().setConnectionState('connecting')
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('useChangeSync', () => {
  it('reloads all displayed query families after the initial sync watermark', async () => {
    const sync = event({ id: '12', eventType: 'post.updated' })
    mocks.streamEvents.mockResolvedValue(pendingSseStream([
      { id: sync.id, event: 'postall.sync', data: sync },
    ]))
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')

    const { unmount } = renderHook(() => useChangeSync(true), { wrapper: wrapper(queryClient) })

    await waitFor(() => expect(invalidate).toHaveBeenCalledTimes(3))
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['channels'] })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['posts'] })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['thread'] })
    unmount()
  })

  it('ignores duplicate event IDs and coalesces cache invalidations by target', async () => {
    const channelId = '11111111-1111-1111-1111-111111111111'
    const rootId = '22222222-2222-2222-2222-222222222222'
    const frames = [
      event({ id: '5', eventType: 'channel.updated', channelId }),
      event({ id: '5', eventType: 'post.created', channelId, postId: rootId }),
      event({ id: '4', eventType: 'reaction.updated', channelId, postId: rootId }),
      event({ id: '6', eventType: 'reply.created', channelId, postId: '33333333-3333-3333-3333-333333333333', threadRootId: rootId }),
      event({
        id: '7',
        eventType: 'reaction.updated',
        channelId: '44444444-4444-4444-4444-444444444444',
        postId: '55555555-5555-5555-5555-555555555555',
      }),
    ]
    mocks.streamEvents.mockResolvedValue(pendingEventStream(frames))
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')

    const { unmount } = renderHook(() => useChangeSync(true), { wrapper: wrapper(queryClient) })

    await waitFor(() => expect(useUi.getState().connectionState).toBe('live'))
    await waitFor(() => expect(invalidate).toHaveBeenCalledTimes(5))
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['channels'] })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['posts', channelId] })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['thread', rootId] })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['posts', '44444444-4444-4444-4444-444444444444'] })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['thread', '55555555-5555-5555-5555-555555555555'] })
    unmount()
  })

  it('marks mutations unavailable when both the stream and health check fail', async () => {
    mocks.streamEvents.mockRejectedValue(new TypeError('network down'))
    mocks.getHealth.mockRejectedValue(new TypeError('network down'))
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    const { unmount } = renderHook(() => useChangeSync(true), { wrapper: wrapper(queryClient) })

    await waitFor(() => expect(useUi.getState().connectionState).toBe('offline'))
    expect(useUi.getState().canMutate).toBe(false)
    unmount()
  })

  it('recovers missed changes and reconnects when the browser comes online', async () => {
    let online = true
    vi.spyOn(navigator, 'onLine', 'get').mockImplementation(() => online)
    mocks.streamEvents.mockImplementation(async () => pendingEventStream([]))
    mocks.getHealth.mockResolvedValue({ status: 'ok', database: 'ok' })
    mocks.listEvents.mockResolvedValue({ events: [], nextAfter: '0', hasMore: false })
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    const { unmount } = renderHook(() => useChangeSync(true), { wrapper: wrapper(queryClient) })
    await waitFor(() => expect(useUi.getState().connectionState).toBe('live'))

    online = false
    window.dispatchEvent(new Event('offline'))
    await waitFor(() => expect(useUi.getState().connectionState).toBe('offline'))
    online = true
    window.dispatchEvent(new Event('online'))

    await waitFor(() => expect(mocks.listEvents).toHaveBeenCalledWith('0', 200), { timeout: 2_500 })
    await waitFor(() => expect(mocks.streamEvents).toHaveBeenCalledTimes(2), { timeout: 2_500 })
    expect(useUi.getState().connectionState).toBe('live')
    unmount()
  })
})

function event(partial: Partial<ChangeEvent> & Pick<ChangeEvent, 'id' | 'eventType'>): ChangeEvent {
  return {
    createdAt: '2026-08-23T00:00:00Z',
    ...partial,
  }
}

function pendingEventStream(events: ChangeEvent[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const item of events) {
        controller.enqueue(encoder.encode(`id: ${item.id}\nevent: ${item.eventType}\ndata: ${JSON.stringify(item)}\n\n`))
      }
    },
  })
}

function pendingSseStream(messages: { id: string; event: string; data: ChangeEvent }[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const message of messages) {
        controller.enqueue(encoder.encode(
          `id: ${message.id}\nevent: ${message.event}\ndata: ${JSON.stringify(message.data)}\n\n`,
        ))
      }
    },
  })
}

function wrapper(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
}
