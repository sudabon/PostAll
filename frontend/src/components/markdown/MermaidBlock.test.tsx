import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MermaidBlock } from './MermaidBlock'

vi.mock('mermaid', () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn().mockRejectedValue(new Error('parse error')),
  },
}))

describe('MermaidBlock', () => {
  afterEach(() => {
    cleanup()
  })

  it('falls back to the source code when rendering fails', async () => {
    render(<MermaidBlock source="graph TD; this is not valid" />)
    expect(await screen.findByText('図の描画に失敗しました')).toBeTruthy()
    await waitFor(() => {
      expect(screen.getByTestId('code-block').textContent).toContain('graph TD')
    })
  })
})
