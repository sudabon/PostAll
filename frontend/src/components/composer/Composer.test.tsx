import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { StrictMode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Attachment } from '@/api/client'
import { Composer } from './Composer'
import { PlatformProvider, createFakeAdapter } from '@/platform'

function renderComposer(
  onSubmit = vi.fn().mockResolvedValue(undefined),
  adapter = createFakeAdapter(),
  mutationDisabled = false,
) {
  return {
    onSubmit,
    adapter,
    ...render(
      <PlatformProvider adapter={adapter}>
        <Composer storageKey="draft:test" mutationDisabled={mutationDisabled} onSubmit={onSubmit} />
      </PlatformProvider>,
    ),
  }
}

describe('Composer', () => {
  afterEach(() => {
    cleanup()
  })

  it('does not submit Shift+Enter inside an unclosed code fence', () => {
    const { onSubmit } = renderComposer()
    const input = screen.getByTestId('composer-input')
    fireEvent.change(input, { target: { value: '```js\nconst x = 1' } })
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true })
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('does not submit on a plain Enter so it inserts a newline', () => {
    const { onSubmit } = renderComposer()
    const input = screen.getByTestId('composer-input')
    fireEvent.change(input, { target: { value: 'こんにちは' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('does not submit while the IME is composing', () => {
    const { onSubmit } = renderComposer()
    const input = screen.getByTestId('composer-input')
    fireEvent.change(input, { target: { value: 'にほんご' } })
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true, isComposing: true })
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('submits on Shift+Enter', async () => {
    const { onSubmit } = renderComposer()
    const input = screen.getByTestId('composer-input')
    fireEvent.change(input, { target: { value: 'こんにちは' } })
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true })
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith('こんにちは', []))
  })

  it('inserts a code fence template', () => {
    renderComposer()
    fireEvent.click(screen.getByTestId('composer-format-codeBlock'))
    expect((screen.getByTestId('composer-input') as HTMLTextAreaElement).value).toContain('```')
  })

  it('rejects an 11th attachment', async () => {
    const files = Array.from({ length: 11 }, (_, i) => ({
      name: `f${i}.png`,
      type: 'image/png',
      data: new Uint8Array([1]).buffer,
    }))
    const { onSubmit } = renderComposer(vi.fn(), createFakeAdapter({ files }))
    fireEvent.click(screen.getByTestId('composer-attach'))
    expect(await screen.findByText(/10/)).toBeTruthy()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('starts one upload per selected file in StrictMode', async () => {
    const file = {
      name: 'once.png',
      type: 'image/png',
      data: new Uint8Array([1]).buffer,
    }
    const uploadFile = vi.fn().mockResolvedValue('attachment-1')
    const adapter = createFakeAdapter({ files: [file] })
    render(
      <StrictMode>
        <PlatformProvider adapter={adapter}>
          <Composer
            storageKey="draft:strict"
            onSubmit={vi.fn().mockResolvedValue(undefined)}
            uploadFile={uploadFile}
          />
        </PlatformProvider>
      </StrictMode>,
    )

    fireEvent.click(screen.getByTestId('composer-attach'))

    await waitFor(() => expect(uploadFile).toHaveBeenCalledTimes(1))
    expect(uploadFile).toHaveBeenCalledWith(file, expect.any(Function))
  })

  it('keeps an offline draft editable and sends it after mutation access returns', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    const adapter = createFakeAdapter()
    const rendered = renderComposer(onSubmit, adapter, true)
    const input = screen.getByTestId('composer-input')

    fireEvent.change(input, { target: { value: '切断中の下書き' } })
    expect(input).not.toBeDisabled()
    expect(screen.getByRole('button', { name: '送信' })).toBeDisabled()
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true })
    expect(onSubmit).not.toHaveBeenCalled()

    rendered.rerender(
      <PlatformProvider adapter={adapter}>
        <Composer storageKey="draft:test" mutationDisabled={false} onSubmit={onSubmit} />
      </PlatformProvider>,
    )
    expect(screen.getByTestId('composer-input')).toHaveValue('切断中の下書き')
    fireEvent.click(screen.getByRole('button', { name: '送信' }))
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith('切断中の下書き', []))
  })
})

const keepAttachment: Attachment = {
  id: 'attachment-1',
  postId: 'post-1',
  fileName: 'keep.txt',
  contentType: 'text/plain',
  sizeBytes: 4,
  checksum: 'keep',
  createdAt: '2026-08-26T00:00:00Z',
}

const removeAttachment: Attachment = {
  ...keepAttachment,
  id: 'attachment-2',
  fileName: 'remove.txt',
  sizeBytes: 6,
  checksum: 'remove',
}

function renderEditor(
  overrides: Partial<Parameters<typeof Composer>[0]> = {},
  adapter = createFakeAdapter(),
) {
  const onSubmit = overrides.onSubmit ?? vi.fn().mockResolvedValue(undefined)
  const onCancel = overrides.onCancel ?? vi.fn()
  return {
    onSubmit,
    onCancel,
    adapter,
    ...render(
      <PlatformProvider adapter={adapter}>
        <Composer
          storageKey="draft:test"
          persistDraft={false}
          submitLabel="保存"
          initialBody="original body"
          initialAttachments={[keepAttachment, removeAttachment]}
          {...overrides}
          onSubmit={onSubmit}
          onCancel={onCancel}
        />
      </PlatformProvider>,
    ),
  }
}

describe('Composer edit mode', () => {
  afterEach(cleanup)

  it('loads the post body and its existing attachments', () => {
    renderEditor()

    expect(screen.getByTestId('composer-input')).toHaveValue('original body')
    const list = screen.getByTestId('post-editor')
    expect(within(list).getByText('keep.txt')).toBeTruthy()
    expect(within(list).getByText('remove.txt')).toBeTruthy()
  })

  it('keeps the attachments left in the form when saving', async () => {
    const { onSubmit } = renderEditor()
    const rows = screen.getAllByRole('listitem')
    const removeRow = rows.find((row) => row.textContent?.includes('remove.txt'))!

    fireEvent.click(within(removeRow).getByRole('button', { name: '除去' }))
    fireEvent.change(screen.getByTestId('composer-input'), { target: { value: 'edited body' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith('edited body', ['attachment-1']))
  })

  it('saves on Shift+Enter like a new post', async () => {
    const { onSubmit } = renderEditor()
    const input = screen.getByTestId('composer-input')

    fireEvent.change(input, { target: { value: 'edited body' } })
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true })

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith('edited body', ['attachment-1', 'attachment-2']),
    )
  })

  it('refuses to save when the body and the attachments are both empty', async () => {
    const { onSubmit } = renderEditor({ initialAttachments: [] })

    fireEvent.change(screen.getByTestId('composer-input'), { target: { value: '   ' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('本文または添付のいずれかが必要です')
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('neither reads nor writes the new-post draft', async () => {
    const adapter = createFakeAdapter()
    await adapter.setItem('draft:test', '別に書きかけの新規投稿')

    renderEditor({}, adapter)

    // 下書きを読み込まない
    await waitFor(() => expect(screen.getByTestId('composer-input')).toHaveValue('original body'))
    fireEvent.change(screen.getByTestId('composer-input'), { target: { value: '編集中の本文' } })

    // 下書きを書き換えない
    await Promise.resolve()
    expect(await adapter.getItem('draft:test')).toBe('別に書きかけの新規投稿')
  })

  it('cancels from the button and from Escape', () => {
    const { onCancel } = renderEditor()

    fireEvent.click(screen.getByRole('button', { name: '取り消し' }))
    expect(onCancel).toHaveBeenCalledTimes(1)

    fireEvent.keyDown(screen.getByTestId('composer-input'), { key: 'Escape' })
    expect(onCancel).toHaveBeenCalledTimes(2)
  })

  it('does not cancel on Escape while the IME is composing', () => {
    const { onCancel } = renderEditor()

    fireEvent.keyDown(screen.getByTestId('composer-input'), { key: 'Escape', isComposing: true })

    expect(onCancel).not.toHaveBeenCalled()
  })
})
