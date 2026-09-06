import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, type Emoji, type Reaction } from '@/api/client'
import { EmojiPicker } from './EmojiPicker'
import { ReactionBar } from './ReactionBar'
import { useUi } from '@/state/ui'
import { MotionTestProvider } from '@/test/motion'

const mocks = vi.hoisted(() => ({
  listEmojis: vi.fn(),
  getEmojiImage: vi.fn(),
  addReaction: vi.fn(),
  removeReaction: vi.fn(),
  createEmoji: vi.fn(),
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

const uploadedEmoji: Emoji = {
  id: '33333333-3333-3333-3333-333333333333',
  shortcode: 'uploaded',
  imagePath: '/v1/emojis/uploaded/image',
  checksum: 'sum-3',
}

function pngFile(name = 'uploaded.png') {
  return new File([new Uint8Array([1, 2, 3])], name, { type: 'image/png' })
}

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
    mocks.createEmoji.mockResolvedValue(uploadedEmoji)
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

  it('opens the upload panel from the picker and returns to the list', async () => {
    renderWithQuery(<EmojiPicker onSelect={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'リアクションを追加' }))

    fireEvent.click(await screen.findByRole('button', { name: 'スタンプを追加' }))
    expect(await screen.findByRole('heading', { name: 'スタンプを追加' })).toBeVisible()
    // 別のダイアログを重ねていない。
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    expect(screen.queryByRole('searchbox', { name: 'ショートコードで絞り込み' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'スタンプの一覧に戻る' }))
    expect(await screen.findByRole('searchbox', { name: 'ショートコードで絞り込み' })).toBeVisible()
  })

  it('offers the upload path even when the catalog is empty', async () => {
    mocks.listEmojis.mockResolvedValue([])
    renderWithQuery(<EmojiPicker onSelect={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'リアクションを追加' }))

    await waitFor(() => expect(screen.getByText('絵文字はまだ登録されていません')).toBeVisible())
    expect(screen.getByRole('button', { name: 'スタンプを追加' })).toBeEnabled()
  })

  it('prefills the shortcode from the file name and registers the stamp', async () => {
    renderWithQuery(<EmojiPicker onSelect={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'リアクションを追加' }))
    fireEvent.click(await screen.findByRole('button', { name: 'スタンプを追加' }))

    const chooser = screen.getByLabelText('スタンプの画像ファイル')
    const submit = screen.getByRole('button', { name: '登録する' })
    expect(submit).toBeDisabled()

    fireEvent.change(chooser, { target: { files: [pngFile('SmartHR logo.png')] } })
    const shortcode = screen.getByLabelText('ショートコード')
    await waitFor(() => expect(shortcode).toHaveValue('smarthr-logo'))
    expect(submit).toBeEnabled()

    fireEvent.click(submit)
    await waitFor(() => expect(mocks.createEmoji).toHaveBeenCalledTimes(1))
    expect(mocks.createEmoji.mock.calls[0]?.[1]).toBe('smarthr-logo')
    // 成功したら一覧へ戻り、カタログを取り直す。
    expect(await screen.findByRole('searchbox', { name: 'ショートコードで絞り込み' })).toBeVisible()
    await waitFor(() => expect(mocks.listEmojis).toHaveBeenCalledTimes(2))
  })

  it('registers the shortcode the user typed over the derived one', async () => {
    renderWithQuery(<EmojiPicker onSelect={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'リアクションを追加' }))
    fireEvent.click(await screen.findByRole('button', { name: 'スタンプを追加' }))

    fireEvent.change(screen.getByLabelText('スタンプの画像ファイル'), {
      target: { files: [pngFile()] },
    })
    const shortcode = screen.getByLabelText('ショートコード')
    await waitFor(() => expect(shortcode).toHaveValue('uploaded'))
    fireEvent.change(shortcode, { target: { value: 'renamed' } })
    fireEvent.click(screen.getByRole('button', { name: '登録する' }))

    await waitFor(() => expect(mocks.createEmoji).toHaveBeenCalledWith(expect.anything(), 'renamed'))
  })

  it('leaves the shortcode empty and blocks submission when the file name gives nothing', async () => {
    renderWithQuery(<EmojiPicker onSelect={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'リアクションを追加' }))
    fireEvent.click(await screen.findByRole('button', { name: 'スタンプを追加' }))

    fireEvent.change(screen.getByLabelText('スタンプの画像ファイル'), {
      target: { files: [pngFile('日本語.png')] },
    })

    // ショートコード欄は選択前から空なので、値そのものは待機の目印にならない。
    // ファイルが入ったときだけ出るヒントの出現を待つ。
    expect(
      await screen.findByText('ファイル名から決められませんでした。ショートコードを入力してください'),
    ).toBeVisible()
    expect(screen.getByLabelText('ショートコード')).toHaveValue('')
    expect(screen.getByRole('button', { name: '登録する' })).toBeDisabled()

    fireEvent.change(screen.getByLabelText('ショートコード'), { target: { value: 'nihongo' } })
    expect(screen.getByRole('button', { name: '登録する' })).toBeEnabled()
  })

  it('never uploads a file the client-side constraints reject', async () => {
    renderWithQuery(<EmojiPicker onSelect={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'リアクションを追加' }))
    fireEvent.click(await screen.findByRole('button', { name: 'スタンプを追加' }))

    const jpeg = new File([new Uint8Array([1])], 'photo.jpg', { type: 'image/jpeg' })
    fireEvent.change(screen.getByLabelText('スタンプの画像ファイル'), { target: { files: [jpeg] } })

    expect(await screen.findByRole('alert')).toHaveTextContent('image/png')
    expect(screen.getByRole('button', { name: '登録する' })).toBeDisabled()
    expect(mocks.createEmoji).not.toHaveBeenCalled()

    const huge = pngFile('huge.png')
    Object.defineProperty(huge, 'size', { value: 512 * 1024 + 1 })
    fireEvent.change(screen.getByLabelText('スタンプの画像ファイル'), { target: { files: [huge] } })

    expect(await screen.findByRole('alert')).toHaveTextContent('512 KiB')
    expect(mocks.createEmoji).not.toHaveBeenCalled()
  })

  it('shows progress and sends a single request when the confirm button is hammered', async () => {
    let release: ((emoji: Emoji) => void) | undefined
    mocks.createEmoji.mockImplementation(
      () => new Promise<Emoji>((resolve) => { release = resolve }),
    )
    renderWithQuery(<EmojiPicker onSelect={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'リアクションを追加' }))
    fireEvent.click(await screen.findByRole('button', { name: 'スタンプを追加' }))
    fireEvent.change(screen.getByLabelText('スタンプの画像ファイル'), {
      target: { files: [pngFile()] },
    })

    const submit = screen.getByRole('button', { name: '登録する' })
    await waitFor(() => expect(submit).toBeEnabled())
    fireEvent.click(submit)
    fireEvent.click(submit)
    fireEvent.click(submit)

    expect(await screen.findByRole('status')).toHaveTextContent('登録中…')
    expect(submit).toBeDisabled()
    expect(mocks.createEmoji).toHaveBeenCalledTimes(1)

    release?.(uploadedEmoji)
    expect(await screen.findByRole('searchbox', { name: 'ショートコードで絞り込み' })).toBeVisible()
  })

  it('keeps the file and shortcode when the server rejects the registration', async () => {
    mocks.createEmoji.mockRejectedValue(
      new ApiError(409, { code: 'shortcode_conflict', message: ':shipit: は既に登録されています' }),
    )
    renderWithQuery(<EmojiPicker onSelect={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'リアクションを追加' }))
    fireEvent.click(await screen.findByRole('button', { name: 'スタンプを追加' }))
    fireEvent.change(screen.getByLabelText('スタンプの画像ファイル'), {
      target: { files: [pngFile('shipit.png')] },
    })
    await waitFor(() => expect(screen.getByLabelText('ショートコード')).toHaveValue('shipit'))
    fireEvent.click(screen.getByRole('button', { name: '登録する' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('既に登録されています')
    // 登録パネルに留まり、選んだファイルとショートコードは保持される。
    expect(screen.getByRole('heading', { name: 'スタンプを追加' })).toBeVisible()
    expect(screen.getByLabelText('ショートコード')).toHaveValue('shipit')
    expect(screen.getByText('shipit.png')).toBeVisible()

    // 同じ内容でそのまま再試行できる。
    mocks.createEmoji.mockResolvedValue(uploadedEmoji)
    fireEvent.click(screen.getByRole('button', { name: '登録する' }))
    await waitFor(() => expect(mocks.createEmoji).toHaveBeenCalledTimes(2))
  })
})
