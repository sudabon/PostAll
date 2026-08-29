import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { StrictMode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
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

  it('does not submit Enter inside an unclosed code fence', () => {
    const { onSubmit } = renderComposer()
    const input = screen.getByTestId('composer-input')
    fireEvent.change(input, { target: { value: '```js\nconst x = 1' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('does not submit while the IME is composing', () => {
    const { onSubmit } = renderComposer()
    const input = screen.getByTestId('composer-input')
    fireEvent.change(input, { target: { value: 'にほんご' } })
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true })
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('submits on a plain Enter', async () => {
    const { onSubmit } = renderComposer()
    const input = screen.getByTestId('composer-input')
    fireEvent.change(input, { target: { value: 'こんにちは' } })
    fireEvent.keyDown(input, { key: 'Enter' })
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
    fireEvent.keyDown(input, { key: 'Enter' })
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
