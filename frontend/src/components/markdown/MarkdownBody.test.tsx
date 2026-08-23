import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MarkdownBody } from './MarkdownBody'
import { PlatformProvider, createFakeAdapter } from '@/platform'

function renderMarkdown(markdown: string, adapter = createFakeAdapter()) {
  return render(
    <PlatformProvider adapter={adapter}>
      <MarkdownBody markdown={markdown} />
    </PlatformProvider>,
  )
}

describe('MarkdownBody', () => {
  afterEach(() => {
    cleanup()
  })

  it('renders headings, emphasis, lists, quotes, and tables', () => {
    renderMarkdown(`# Title

**bold** and *italic*

- item

> quote

| a | b |
| - | - |
| 1 | 2 |
`)
    expect(screen.getByRole('heading', { name: 'Title' })).toBeTruthy()
    expect(screen.getByText('bold')).toBeTruthy()
    expect(screen.getByText('item')).toBeTruthy()
    expect(screen.getByText('quote')).toBeTruthy()
    expect(screen.getByRole('table')).toBeTruthy()
  })

  it('does not execute script tags or javascript links', () => {
    const adapter = createFakeAdapter()
    const spy = vi.spyOn(adapter, 'openExternal')
    renderMarkdown('<script>window.__xss = 1</script>\n[bad](javascript:alert(1))\n[ok](https://example.com)', adapter)
    expect((window as unknown as { __xss?: number }).__xss).toBeUndefined()
    expect(document.querySelector('script')).toBeNull()
    expect(screen.queryByRole('link', { name: 'bad' })).toBeNull()
    expect(screen.getByRole('link', { name: 'ok' })).toBeTruthy()
    expect(spy).not.toHaveBeenCalled()
  })
})
