import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { Channel, SearchInput, SearchResultPage } from '@/api/client'
import { MotionTestProvider } from '@/test/motion'
import { SearchDialog } from './SearchDialog'

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true
  }
  HTMLDialogElement.prototype.close = function () {
    this.open = false
  }
})

afterEach(cleanup)

const channel: Channel = {
  id: '11111111-1111-1111-1111-111111111111',
  parentId: null,
  name: 'メモ',
  sortKey: 'a',
  createdAt: '2026-08-23T00:00:00Z',
  updatedAt: '2026-08-23T00:00:00Z',
}

function renderDialog(search: (input: SearchInput) => Promise<SearchResultPage>, onSelect = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  function Harness() {
    const [open, setOpen] = useState(true)
    return (
      <SearchDialog
        open={open}
        channels={[channel]}
        search={search}
        onClose={() => setOpen(false)}
        onSelect={onSelect}
      />
    )
  }
  render(
    <QueryClientProvider client={client}>
      <Harness />
    </QueryClientProvider>,
    { wrapper: MotionTestProvider },
  )
  return onSelect
}

describe('SearchDialog', () => {
  it('requires two characters, exposes visible filters, and highlights safe result text', async () => {
    const page: SearchResultPage = {
      results: [
        {
          postId: '22222222-2222-2222-2222-222222222222',
          timelinePostId: '22222222-2222-2222-2222-222222222222',
          channelId: channel.id,
          channelName: channel.name,
          threadRootId: null,
          body: '本文の検索対象 <script>danger</script>',
          createdAt: '2026-08-23T01:00:00Z',
        },
      ],
      nextCursor: null,
    }
    const search = vi.fn<(input: SearchInput) => Promise<SearchResultPage>>().mockResolvedValue(page)
    const onSelect = renderDialog(search)

    await waitFor(() => expect(screen.getByLabelText('検索語')).toBeVisible())
    expect(screen.getByLabelText('チャネル')).toBeVisible()
    expect(screen.getByLabelText('開始日')).toBeVisible()
    expect(screen.getByLabelText('終了日')).toBeVisible()

    fireEvent.change(screen.getByLabelText('検索語'), { target: { value: '検' } })
    fireEvent.submit(screen.getByRole('search'))
    expect(await screen.findByText('検索語は2文字以上で入力してください')).toBeVisible()
    expect(search).not.toHaveBeenCalled()

    fireEvent.change(screen.getByLabelText('検索語'), { target: { value: '検索対象' } })
    fireEvent.change(screen.getByLabelText('チャネル'), { target: { value: channel.id } })
    fireEvent.submit(screen.getByRole('search'))
    expect(await screen.findByText('検索対象', { selector: 'mark' })).toBeVisible()
    expect(screen.getByText(/<script>danger<\/script>/)).toBeVisible()
    expect(document.querySelector('script')).toBeNull()
    expect(search).toHaveBeenCalledWith(expect.objectContaining({ query: '検索対象', channelId: channel.id }))

    fireEvent.click(screen.getByRole('button', { name: /本文の検索対象/ }))
    await waitFor(() => expect(onSelect).toHaveBeenCalledWith(page.results[0]))
  })

  it('loads another cursor page and displays an empty state', async () => {
    const search = vi.fn<(input: SearchInput) => Promise<SearchResultPage>>()
      .mockResolvedValueOnce({
        results: [{
          postId: '33333333-3333-3333-3333-333333333333',
          timelinePostId: '33333333-3333-3333-3333-333333333333',
          channelId: channel.id,
          channelName: channel.name,
          threadRootId: null,
          body: '検索結果その一',
          createdAt: '2026-08-23T02:00:00Z',
        }],
        nextCursor: 'cursor-1',
      })
      .mockResolvedValueOnce({ results: [], nextCursor: null })
      .mockResolvedValueOnce({ results: [], nextCursor: null })
    renderDialog(search)

    fireEvent.change(screen.getByLabelText('検索語'), { target: { value: '検索結果' } })
    fireEvent.submit(screen.getByRole('search'))
    expect(await screen.findByText('さらに読み込む')).toBeVisible()
    fireEvent.click(screen.getByText('さらに読み込む'))
    await waitFor(() => expect(search).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: 'cursor-1' })))

    fireEvent.change(screen.getByLabelText('検索語'), { target: { value: '一致なし' } })
    fireEvent.submit(screen.getByRole('search'))
    expect(await screen.findByText('一致するポストはありません')).toBeVisible()
  })
})
