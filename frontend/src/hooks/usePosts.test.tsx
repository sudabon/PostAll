import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useTimeline } from './usePosts'

const mocks = vi.hoisted(() => ({
  listPosts: vi.fn(),
}))

vi.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({
    api: { listPosts: mocks.listPosts },
    signedIn: true,
  }),
}))

beforeEach(() => {
  mocks.listPosts.mockReset()
})

describe('useTimeline around navigation', () => {
  it('uses around only for the initial page and continues with the returned cursor', async () => {
    mocks.listPosts
      .mockResolvedValueOnce({ posts: [], nextBefore: 'older-cursor' })
      .mockResolvedValueOnce({ posts: [], nextBefore: null })
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    )

    const { result } = renderHook(
      () => useTimeline('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222'),
      { wrapper },
    )

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(mocks.listPosts).toHaveBeenNthCalledWith(
      1,
      '11111111-1111-1111-1111-111111111111',
      { limit: 10, before: undefined, around: '22222222-2222-2222-2222-222222222222' },
    )

    await result.current.fetchNextPage()
    expect(mocks.listPosts).toHaveBeenNthCalledWith(
      2,
      '11111111-1111-1111-1111-111111111111',
      { limit: 10, before: 'older-cursor', around: undefined },
    )
  })
})
