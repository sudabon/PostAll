import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChangeEvent } from '@/api/client'
import { useUi } from '@/state/ui'
import { useChangeSync } from './useChangeSync'

const mocks = vi.hoisted(() => ({
  listEvents: vi.fn(),
  getHealth: vi.fn(),
  onSignal: null as null | (() => void),
  onStatus: null as null | ((subscribed: boolean) => void),
  autoSubscribe: true,
  subscribeCalls: 0,
  getAccessToken: vi.fn(),
  platform: { kind: 'fake' },
}))

vi.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({
    api: mocks,
    signedIn: true,
  }),
}))

vi.mock('@/auth/session', () => ({
  currentAccessToken: () => 'access-token',
  accessTokenForRequest: mocks.getAccessToken,
}))

vi.mock('@/platform', () => ({
  usePlatform: () => mocks.platform,
}))

vi.mock('@/lib/realtime', () => ({
  subscribePostallEvents: (input: {
    getAccessToken?: () => Promise<string | null>
    onSignal: () => void
    onStatus: (subscribed: boolean) => void
  }) => {
    mocks.subscribeCalls += 1
    mocks.onSignal = input.onSignal
    mocks.onStatus = input.onStatus
    if (input.getAccessToken) void input.getAccessToken()
    if (mocks.autoSubscribe) queueMicrotask(() => input.onStatus(true))
    return () => {}
  },
}))

beforeEach(() => {
  mocks.listEvents.mockReset()
  mocks.getHealth.mockReset()
  mocks.onSignal = null
  mocks.onStatus = null
  mocks.autoSubscribe = true
  mocks.subscribeCalls = 0
  mocks.getAccessToken.mockReset()
  mocks.getAccessToken.mockResolvedValue('access-token')
  mocks.getHealth.mockResolvedValue({ status: 'ok', database: 'ok' })
  mocks.listEvents.mockResolvedValue({ events: [], nextAfter: '0', hasMore: false })
  useUi.getState().setConnectionState('connecting')
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('useChangeSync', () => {
  it('reloads all displayed query families after realtime subscribe', async () => {
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
    mocks.listEvents.mockResolvedValue({ events: frames, nextAfter: '7', hasMore: false })
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')

    const { unmount } = renderHook(() => useChangeSync(true), { wrapper: wrapper(queryClient) })

    await waitFor(() => expect(useUi.getState().connectionState).toBe('live'))
    await waitFor(() => expect(invalidate).toHaveBeenCalled())
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['channels'] })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['posts', channelId] })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['thread', rootId] })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['posts', '44444444-4444-4444-4444-444444444444'] })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['thread', '55555555-5555-5555-5555-555555555555'] })
    unmount()
  })

  it('marks mutations unavailable when both the notification path and health check fail', async () => {
    mocks.getHealth.mockRejectedValue(new TypeError('network down'))
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    const { unmount } = renderHook(() => useChangeSync(true), { wrapper: wrapper(queryClient) })

    await waitFor(() => expect(useUi.getState().connectionState).toBe('offline'))
    expect(useUi.getState().canMutate).toBe(false)
    unmount()
  })

  it('recovers missed changes when the browser comes online', async () => {
    let online = true
    vi.spyOn(navigator, 'onLine', 'get').mockImplementation(() => online)
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    const { unmount } = renderHook(() => useChangeSync(true), { wrapper: wrapper(queryClient) })
    await waitFor(() => expect(useUi.getState().connectionState).toBe('live'))

    online = false
    window.dispatchEvent(new Event('offline'))
    await waitFor(() => expect(useUi.getState().connectionState).toBe('offline'))
    online = true
    window.dispatchEvent(new Event('online'))

    await waitFor(() => expect(mocks.listEvents).toHaveBeenCalledWith('0', 200), { timeout: 2_500 })
    expect(useUi.getState().connectionState).toBe('live')
    unmount()
  })

  it('polls while degraded and reconnects with a fresh token after backoff', async () => {
    vi.useFakeTimers()
    mocks.autoSubscribe = false
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    const { unmount } = renderHook(() => useChangeSync(true), { wrapper: wrapper(queryClient) })
    expect(mocks.subscribeCalls).toBe(1)

    act(() => mocks.onStatus?.(false))
    expect(useUi.getState().connectionState).toBe('degraded')
    await act(() => vi.advanceTimersByTimeAsync(1_000))

    expect(mocks.subscribeCalls).toBe(2)
    expect(mocks.getAccessToken).toHaveBeenCalledTimes(2)
    unmount()
  })
})

function event(partial: Partial<ChangeEvent> & Pick<ChangeEvent, 'id' | 'eventType'>): ChangeEvent {
  return {
    createdAt: '2026-08-23T00:00:00Z',
    ...partial,
  }
}

function wrapper(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
}
