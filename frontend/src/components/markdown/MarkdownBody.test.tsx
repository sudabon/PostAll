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

  it('renders a single newline as a line break', () => {
    const { container } = renderMarkdown('1行目\n2行目')
    expect(container.querySelectorAll('br')).toHaveLength(1)
    expect(container.querySelector('p')?.textContent).toBe('1行目\n2行目')
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

  it('renders an underline written as raw <u> HTML', () => {
    const { container } = renderMarkdown('<u>\u4e0b\u7dda</u>')
    const u = container.querySelector('u')
    expect(u).not.toBeNull()
    expect(u?.textContent).toBe('\u4e0b\u7dda')
  })

  it('strips raw HTML outside the allow list', () => {
    const { container } = renderMarkdown(
      '<img src="x" onerror="window.__xss = 1">\n<iframe src="https://example.com"></iframe>\n<u onclick="window.__xss = 1">ok</u>',
    )
    expect((window as unknown as { __xss?: number }).__xss).toBeUndefined()
    expect(container.querySelector('iframe')).toBeNull()
    expect(container.querySelector('[onerror]')).toBeNull()
    expect(container.querySelector('u')?.getAttribute('onclick')).toBeNull()
  })
})
