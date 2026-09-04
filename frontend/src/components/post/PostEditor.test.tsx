import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Attachment, Post } from '@/api/client'
import { postChangedElsewhereMessage, staleEditDiscardedMessage } from '@/lib/submit-failure'
import { PlatformProvider, createFakeAdapter } from '@/platform'
import { useUi } from '@/state/ui'
import { PostEditor } from './PostEditor'

const mocks = vi.hoisted(() => ({
  getDownloadUrl: vi.fn(),
}))

vi.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({ api: { getDownloadUrl: mocks.getDownloadUrl } }),
}))

const postAttachment: Attachment = {
  id: 'attachment-original',
  postId: 'post-1',
  fileName: 'original.txt',
  contentType: 'text/plain',
  sizeBytes: 8,
  checksum: 'original',
  createdAt: '2026-09-04T00:00:00Z',
}

const restoredAttachment: Attachment = {
  ...postAttachment,
  id: 'attachment-restored',
  fileName: 'restored.txt',
  checksum: 'restored',
}

const post: Post = {
  id: 'post-1',
  channelId: 'channel-1',
  threadRootId: null,
  authorId: 'author-1',
  body: 'original body',
  createdAt: '2026-09-04T00:00:00Z',
  updatedAt: '2026-09-04T00:00:00Z',
  editedAt: null,
  deleted: false,
  replyCount: 0,
  lastReplyAt: null,
  attachments: [postAttachment],
  reactions: [],
}

function EditorHarness() {
  const editing = useUi((state) => state.editingPostId === post.id)
  return editing ? (
    <PlatformProvider adapter={createFakeAdapter()}>
      <PostEditor post={post} mutationDisabled={false} onSave={vi.fn()} />
    </PlatformProvider>
  ) : null
}

// jsdom は scrollIntoView を実装しないので、spyOn できるよう先に生やしておく。
Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {})

describe('PostEditor', () => {
  let scrollIntoView: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    mocks.getDownloadUrl.mockReset()
    scrollIntoView = vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(() => {})
    useUi.setState({ editingPostId: post.id, autoOpenedEditPostId: null, failedEdits: {} })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('保存失敗後に本文・添付・エラーを編集フォームへ復元する', () => {
    useUi.getState().setFailedEdit(post.id, {
      body: 'restored body',
      attachments: [restoredAttachment],
      error: '保存に失敗しました。入力は保持されています。',
      postUpdatedAt: post.updatedAt,
    })
    render(<EditorHarness />)

    expect(screen.getByTestId('composer-input')).toHaveValue('restored body')
    const editor = screen.getByTestId(`post-editor-${post.id}`)
    expect(within(editor).getByText('restored.txt')).toBeVisible()
    expect(within(editor).queryByText('original.txt')).toBeNull()
    expect(within(editor).getByRole('alert')).toHaveTextContent(
      '保存に失敗しました。入力は保持されています。',
    )
  })

  it('ポスト更新後は保持入力を破棄して通知する', async () => {
    useUi.getState().setFailedEdit(post.id, {
      body: 'stale body',
      attachments: [restoredAttachment],
      error: '保存に失敗しました。入力は保持されています。',
      postUpdatedAt: '2026-09-03T00:00:00Z',
    })

    render(<EditorHarness />)

    expect(screen.getByTestId('composer-input')).toHaveValue(post.body)
    const editor = screen.getByTestId(`post-editor-${post.id}`)
    expect(within(editor).getByText('original.txt')).toBeVisible()
    expect(within(editor).queryByText('restored.txt')).toBeNull()
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(staleEditDiscardedMessage)
      expect(useUi.getState().failedEdits[post.id]?.discarded).toBe(true)
    })
  })

  it('入力中に保存失敗が届いても本文を保ったままエラーを表示する', async () => {
    render(<EditorHarness />)
    const input = screen.getByTestId('composer-input')
    fireEvent.change(input, { target: { value: 'user is typing this' } })

    act(() => {
      useUi.getState().setFailedEdit(post.id, {
        body: 'older failed body',
        attachments: [restoredAttachment],
        error: '保存に失敗しました。入力は保持されています。',
        postUpdatedAt: post.updatedAt,
      })
    })

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        '保存に失敗しました。入力は保持されています。',
      ),
    )
    // 掴んだままの参照だと、再マウントで DOM から外れた古い textarea を見てしまい
    // 入力が消える退行を見逃す。アサート時点で引き直す。
    expect(screen.getByTestId('composer-input')).toHaveValue('user is typing this')
  })

  it('保存失敗時の空本文を元の本文で置き換えない', () => {
    useUi.getState().setFailedEdit(post.id, {
      body: '',
      attachments: [restoredAttachment],
      error: '保存に失敗しました。入力は保持されています。',
      postUpdatedAt: post.updatedAt,
    })

    render(<EditorHarness />)

    expect(screen.getByTestId('composer-input')).toHaveValue('')
  })

  it('取り消しで保持入力を破棄して編集フォームを閉じる', () => {
    useUi.getState().setFailedEdit(post.id, {
      body: 'restored body',
      attachments: [restoredAttachment],
      error: '保存に失敗しました。入力は保持されています。',
      postUpdatedAt: post.updatedAt,
    })
    render(<EditorHarness />)

    fireEvent.click(screen.getByRole('button', { name: '取り消し' }))

    expect(useUi.getState().failedEdits[post.id]).toBeUndefined()
    expect(useUi.getState().editingPostId).toBeNull()
    expect(screen.queryByTestId(`post-editor-${post.id}`)).toBeNull()
  })

  it('失敗による自動再オープンではフォーカスもスクロールも奪わない', () => {
    useUi.getState().setFailedEdit(post.id, {
      body: 'restored body',
      attachments: [restoredAttachment],
      error: '保存に失敗しました。入力は保持されています。',
      postUpdatedAt: post.updatedAt,
    })
    useUi.setState({ autoOpenedEditPostId: post.id })

    render(<EditorHarness />)

    expect(screen.getByTestId('composer-input')).not.toBe(document.activeElement)
    expect(scrollIntoView).not.toHaveBeenCalled()
  })

  it('ユーザーが自分で開いたときはフォーカスとスクロールを行う', () => {
    useUi.getState().setFailedEdit(post.id, {
      body: 'restored body',
      attachments: [restoredAttachment],
      error: '保存に失敗しました。入力は保持されています。',
      postUpdatedAt: post.updatedAt,
    })

    render(<EditorHarness />)

    expect(screen.getByTestId('composer-input')).toBe(document.activeElement)
  })

  it('開いている最中にポストが更新されたら入力を残したまま上書きを警告する', async () => {
    render(<EditorHarness />)
    fireEvent.change(screen.getByTestId('composer-input'), { target: { value: 'my own draft' } })

    act(() => {
      useUi.getState().setFailedEdit(post.id, {
        body: 'older failed body',
        attachments: [restoredAttachment],
        error: '保存に失敗しました。入力は保持されています。',
        postUpdatedAt: '2026-09-03T00:00:00Z',
      })
    })

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(postChangedElsewhereMessage),
    )
    // 画面の入力は勝手に捨てない
    expect(screen.getByTestId('composer-input')).toHaveValue('my own draft')
  })
})
