import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { StrictMode, type ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Channel } from '@/api/client'
import { useUi } from '@/state/ui'
import { useRestoreSelectedChannel } from './useRestoreSelectedChannel'

const mocks = vi.hoisted(() => ({ listChannels: vi.fn() }))
vi.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({ api: { listChannels: mocks.listChannels }, signedIn: true }),
}))

const channel: Channel = {
  id: '11111111-1111-1111-1111-111111111111',
  parentId: null,
  name: 'inbox',
  sortKey: 'a',
  createdAt: '2026-09-07T00:00:00Z',
  updatedAt: '2026-09-07T00:00:00Z',
}

beforeEach(() => {
  mocks.listChannels.mockReset()
  window.history.replaceState({}, '', '/')
  useUi.setState({ selectedChannelId: channel.id, narrowScreen: 'timeline' })
})

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const hook = renderHook(() => useRestoreSelectedChannel(), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <StrictMode><QueryClientProvider client={client}>{children}</QueryClientProvider></StrictMode>
    ),
  })
  return { client, ...hook }
}

describe('useRestoreSelectedChannel', () => {
  it('clears a missing restored channel once after a successful fetch', async () => {
    mocks.listChannels.mockResolvedValue([])
    const { client, rerender } = setup()
    await waitFor(() => expect(useUi.getState().selectedChannelId).toBeNull())
    expect(useUi.getState().narrowScreen).toBe('channels')

    // 起動後の選択は、古い一覧や再取得で解除しない。
    act(() => useUi.getState().selectChannel('new-channel'))
    await act(async () => { await client.invalidateQueries({ queryKey: ['channels'] }) })
    rerender()
    expect(useUi.getState().selectedChannelId).toBe('new-channel')
  })

  it('keeps a restored channel that exists and checks only once', async () => {
    mocks.listChannels.mockResolvedValue([channel])
    const { client } = setup()
    await waitFor(() => expect(client.getQueryState(['channels'])?.status).toBe('success'))
    expect(useUi.getState().selectedChannelId).toBe(channel.id)
    mocks.listChannels.mockResolvedValue([])
    await act(async () => { await client.invalidateQueries({ queryKey: ['channels'] }) })
    expect(useUi.getState().selectedChannelId).toBe(channel.id)
  })

  it('waits for a pending fetch before clearing a missing channel', async () => {
    let resolve!: (channels: Channel[]) => void
    mocks.listChannels.mockReturnValue(new Promise<Channel[]>((done) => { resolve = done }))
    const { client } = setup()
    expect(client.getQueryState(['channels'])?.status).toBe('pending')
    expect(useUi.getState().selectedChannelId).toBe(channel.id)
    await act(async () => resolve([]))
    await waitFor(() => expect(useUi.getState().selectedChannelId).toBeNull())
  })

  it('retains the selection on failure and validates after recovery', async () => {
    mocks.listChannels.mockRejectedValue(new Error('offline'))
    const { client } = setup()
    await waitFor(() => expect(client.getQueryState(['channels'])?.status).toBe('error'))
    expect(useUi.getState().selectedChannelId).toBe(channel.id)
    expect(useUi.getState().narrowScreen).toBe('timeline')
    mocks.listChannels.mockResolvedValue([])
    await act(async () => { await client.invalidateQueries({ queryKey: ['channels'] }) })
    await waitFor(() => expect(useUi.getState().selectedChannelId).toBeNull())
  })

  it('does not clear a channel selected while the initial fetch was pending', async () => {
    let resolve!: (channels: Channel[]) => void
    mocks.listChannels.mockReturnValue(new Promise<Channel[]>((done) => { resolve = done }))
    setup()
    act(() => useUi.getState().selectChannel('new-channel'))
    await act(async () => resolve([]))
    expect(useUi.getState().selectedChannelId).toBe('new-channel')
  })

  it('does not validate new selections when there was no restored channel', async () => {
    useUi.setState({ selectedChannelId: null, narrowScreen: 'channels' })
    mocks.listChannels.mockResolvedValue([])
    const { client } = setup()
    await waitFor(() => expect(client.getQueryState(['channels'])?.status).toBe('success'))
    act(() => useUi.getState().selectChannel('new-channel'))
    expect(useUi.getState().selectedChannelId).toBe('new-channel')
  })
})
