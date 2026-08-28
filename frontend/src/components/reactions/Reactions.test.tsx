import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Emoji, Reaction } from '@/api/client'
import { EmojiPicker } from './EmojiPicker'
import { ReactionBar } from './ReactionBar'
import { useUi } from '@/state/ui'
import { MotionTestProvider } from '@/test/motion'

const mocks = vi.hoisted(() => ({
  listEmojis: vi.fn(),
  getEmojiImage: vi.fn(),
  addReaction: vi.fn(),
  removeReaction: vi.fn(),
}))

vi.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({ api: mocks, signedIn: true }),
}))

const emojis: Emoji[] = [
  {
    id: '11111111-1111-1111-1111-111111111111',
    shortcode: 'shipit',
    imagePath: '/v1/emojis/shipit/image',
    checksum: 'sum-1',
  },
  {
    id: '22222222-2222-2222-2222-222222222222',
    shortcode: 'party',
    imagePath: '/v1/emojis/party/image',
    checksum: 'sum-2',
  },
]

function renderWithQuery(ui: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>, {
    wrapper: MotionTestProvider,
  })
}

describe('emoji reactions', () => {
  beforeEach(() => {
    useUi.getState().setConnectionState('live')
    mocks.listEmojis.mockResolvedValue(emojis)
    mocks.getEmojiImage.mockResolvedValue(new Blob(['png'], { type: 'image/png' }))
    mocks.addReaction.mockResolvedValue({
      emoji: emojis[0],
      count: 1,
      reactedByMe: true,
      reactorIds: [],
    })
    mocks.removeReaction.mockResolvedValue(undefined)
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('lists and filters catalog emojis by shortcode', async () => {
    const onSelect = vi.fn()
    renderWithQuery(<EmojiPicker onSelect={onSelect} />)

    fireEvent.click(screen.getByRole('button', { name: 'リアクションを追加' }))
    const search = await screen.findByRole('searchbox', { name: 'ショートコードで絞り込み' })
    expect(await screen.findByRole('button', { name: ':shipit:' })).toBeVisible()
    expect(screen.getByRole('button', { name: ':party:' })).toBeVisible()

    fireEvent.change(search, { target: { value: 'part' } })
    expect(screen.queryByRole('button', { name: ':shipit:' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: ':party:' }))
    expect(onSelect).toHaveBeenCalledWith(emojis[1])
  })

  it('uses a native modal and restores focus after Escape', async () => {
    renderWithQuery(<EmojiPicker onSelect={vi.fn()} />)
    const trigger = screen.getByRole('button', { name: 'リアクションを追加' })
    trigger.focus()
    fireEvent.click(trigger)

    const dialog = await screen.findByRole('dialog', { name: 'リアクションを追加' })
    expect(dialog.tagName).toBe('DIALOG')

    fireEvent(dialog, new Event('cancel', { cancelable: true }))

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'リアクションを追加' })).toBeNull())
    await waitFor(() => expect(trigger).toHaveFocus())
  })

  it('shows an empty catalog as a normal picker state', async () => {
    mocks.listEmojis.mockResolvedValue([])
    renderWithQuery(<EmojiPicker onSelect={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'リアクションを追加' }))
    await waitFor(() => expect(screen.getByText('絵文字はまだ登録されていません')).toBeVisible())
  })

  it('shows self state, reactor details, image fallback, and a rollback error', async () => {
    mocks.getEmojiImage.mockRejectedValue(new Error('missing image'))
    mocks.removeReaction.mockRejectedValue(new Error('server rejected'))
    const reaction: Reaction = {
      emoji: emojis[0]!,
      count: 2,
      reactedByMe: true,
      reactorIds: [
        'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      ],
    }
    renderWithQuery(
      <ReactionBar
        postId="33333333-3333-3333-3333-333333333333"
        reactions={[reaction]}
      />,
    )

    const toggle = screen.getByRole('button', { name: /:shipit: 2件/ })
    expect(toggle).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByRole('tooltip')).toBeNull()
    fireEvent.pointerEnter(toggle)
    expect(screen.getByRole('tooltip')).toHaveTextContent('自分')
    expect(screen.getByRole('tooltip')).toHaveTextContent('bbbbbbbb…')
    fireEvent.pointerLeave(toggle)
    await waitFor(() => expect(screen.queryByRole('tooltip')).toBeNull())

    toggle.getBoundingClientRect = () => ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 80,
      bottom: 28,
      width: 80,
      height: 28,
      toJSON: () => ({}),
    })
    toggle.setPointerCapture = vi.fn()
    toggle.releasePointerCapture = vi.fn()
    fireEvent.pointerDown(toggle, { pointerId: 1, button: 0, clientX: 40, clientY: 14 })
    expect(toggle).toHaveAttribute('data-pressed')
    fireEvent.pointerUp(toggle, { pointerId: 1, clientX: 40, clientY: 14 })
    expect(toggle).not.toHaveAttribute('data-pressed')
    const fallback = await screen.findByText(':shipit:')
    expect(fallback).toBeVisible()
    expect(fallback).toHaveClass('truncate')

    fireEvent.click(toggle)
    await waitFor(() => expect(mocks.removeReaction).toHaveBeenCalled())
    expect(await screen.findByRole('alert')).toHaveTextContent('リアクションを更新できませんでした')
  })

  it('does not mutate reactions while offline', () => {
    useUi.getState().setConnectionState('offline')
    const reaction: Reaction = {
      emoji: emojis[0]!,
      count: 1,
      reactedByMe: false,
      reactorIds: ['aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'],
    }
    renderWithQuery(
      <ReactionBar postId="33333333-3333-3333-3333-333333333333" reactions={[reaction]} />,
    )

    expect(screen.getByRole('button', { name: /:shipit: 1件/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'リアクションを追加' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: /:shipit: 1件/ }))
    expect(mocks.addReaction).not.toHaveBeenCalled()
  })
})
