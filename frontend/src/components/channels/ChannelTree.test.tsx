import { render, screen, fireEvent } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Channel } from '@/api/client'
import { ChannelTree } from './ChannelTree'
import { useUi } from '@/state/ui'

const rename = vi.fn()

const channels: Channel[] = [
  {
    id: '11111111-1111-1111-1111-111111111111',
    parentId: null,
    name: 'inbox',
    sortKey: 'n',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  },
]

vi.mock('@/hooks/useChannels', async () => {
  const actual = await vi.importActual<typeof import('@/hooks/useChannels')>('@/hooks/useChannels')
  return {
    ...actual,
    useChannels: () => ({ data: channels, isError: false, refetch: vi.fn() }),
    useChannelMutations: () => ({
      create: { mutate: vi.fn() },
      rename: { mutate: rename },
      remove: { mutate: vi.fn() },
      move: { mutate: vi.fn() },
    }),
  }
})

function startRenaming() {
  render(<ChannelTree />)
  fireEvent.doubleClick(screen.getByTestId('channel-inbox'))
  return screen.getByTestId('channel-name-input')
}

describe('ChannelTree のチャネル名編集', () => {
  beforeEach(() => {
    rename.mockReset()
    useUi.getState().hydrate({ renamingId: null, creating: null, canMutate: true, selectedChannelId: null })
  })

  it('ダブルクリックで既存のチャネル名が入力欄に入る', () => {
    expect(startRenaming()).toHaveValue('inbox')
  })

  it('選択中の行でも入力文字が背景色を継承しない', () => {
    // 選択中の行は text-primary-foreground を継承するため、
    // 色を明示しないと背景と同色になり名前が見えなくなる
    expect(startRenaming().className).toContain('text-foreground')
  })

  it('入力欄からフォーカスが外れると変更が確定する', () => {
    const input = startRenaming()
    fireEvent.change(input, { target: { value: 'archive' } })
    fireEvent.blur(input)

    expect(rename).toHaveBeenCalledWith(
      expect.objectContaining({ id: channels[0].id, name: 'archive' }),
      expect.anything(),
    )
  })

  it('名前を変えずにフォーカスが外れたら編集を閉じるだけ', () => {
    fireEvent.blur(startRenaming())

    expect(rename).not.toHaveBeenCalled()
    expect(useUi.getState().renamingId).toBeNull()
    expect(screen.queryByTestId('channel-name-input')).toBeNull()
  })

  it('空欄でフォーカスが外れたら編集を取り消す', () => {
    const input = startRenaming()
    fireEvent.change(input, { target: { value: '   ' } })
    fireEvent.blur(input)

    expect(rename).not.toHaveBeenCalled()
    expect(useUi.getState().renamingId).toBeNull()
  })

  it('Enter で確定した後の blur では二重に送信しない', () => {
    const input = startRenaming()
    fireEvent.change(input, { target: { value: 'archive' } })
    fireEvent.submit(input.closest('form')!)
    fireEvent.blur(input)

    expect(rename).toHaveBeenCalledTimes(1)
  })

  it('Escape で取り消した後の blur では送信しない', () => {
    const input = startRenaming()
    fireEvent.change(input, { target: { value: 'archive' } })
    fireEvent.keyDown(input, { key: 'Escape' })
    fireEvent.blur(input)

    expect(rename).not.toHaveBeenCalled()
    expect(useUi.getState().renamingId).toBeNull()
  })
})
