import { render, screen, fireEvent } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Channel } from '@/api/client'
import { ChannelTree } from './ChannelTree'
import { useUi } from '@/state/ui'

const rename = vi.fn()
const create = vi.hoisted(() => vi.fn())
const encryption = vi.hoisted(() => ({
  phase: 'unlocked' as 'unlocked' | 'locked' | 'unconfigured',
  requestSetup: vi.fn(async () => false),
  requestUnlock: vi.fn(async () => true),
}))

vi.mock('@/encryption/encryption-context', () => ({
  useEncryptionOptional: () => encryption,
}))

const channels: Channel[] = [
  {
    id: '11111111-1111-1111-1111-111111111111',
    parentId: null,
    name: 'inbox',
    sortKey: 'n',
    encrypted: false,
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
      create: { mutate: create },
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
    create.mockReset()
    encryption.phase = 'unlocked'
    encryption.requestSetup.mockReset()
    encryption.requestSetup.mockResolvedValue(false)
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

describe('ChannelTree の暗号化', () => {
  beforeEach(() => {
    create.mockReset()
    encryption.phase = 'unlocked'
    encryption.requestSetup.mockReset()
    encryption.requestSetup.mockResolvedValue(false)
    useUi.getState().hydrate({ renamingId: null, creating: null, canMutate: true, selectedChannelId: null })
  })

  it('既定では暗号化せず、選んだときだけ暗号化チャネルとして作る', () => {
    render(<ChannelTree />)
    fireEvent.click(screen.getByTestId('new-channel-button'))
    const toggle = screen.getByTestId('channel-encrypted-toggle')
    expect(toggle).not.toBeChecked()
    fireEvent.change(screen.getByTestId('channel-name-input'), { target: { value: 'inbox2' } })
    fireEvent.submit(screen.getByTestId('channel-name-input').closest('form')!)
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ name: 'inbox2', encrypted: false }), expect.anything())

    create.mockClear()
    fireEvent.click(screen.getByTestId('new-channel-button'))
    fireEvent.click(screen.getByTestId('channel-encrypted-toggle'))
    fireEvent.change(screen.getByTestId('channel-name-input'), { target: { value: 'secret' } })
    fireEvent.submit(screen.getByTestId('channel-name-input').closest('form')!)
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ name: 'secret', encrypted: true }), expect.anything())
  })

  it('鍵が未設定なら初期設定が終わるまで作成しない', async () => {
    encryption.phase = 'unconfigured'
    render(<ChannelTree />)
    fireEvent.click(screen.getByTestId('new-channel-button'))
    fireEvent.click(screen.getByTestId('channel-encrypted-toggle'))
    fireEvent.change(screen.getByTestId('channel-name-input'), { target: { value: 'secret' } })
    fireEvent.submit(screen.getByTestId('channel-name-input').closest('form')!)
    await vi.waitFor(() => expect(encryption.requestSetup).toHaveBeenCalled())
    expect(create).not.toHaveBeenCalled()
  })

  it('初期設定を取りやめたら、同じ名前のまま確定し直せる', async () => {
    encryption.phase = 'unconfigured'
    render(<ChannelTree />)
    fireEvent.click(screen.getByTestId('new-channel-button'))
    fireEvent.click(screen.getByTestId('channel-encrypted-toggle'))
    fireEvent.change(screen.getByTestId('channel-name-input'), { target: { value: 'secret' } })
    fireEvent.submit(screen.getByTestId('channel-name-input').closest('form')!)
    await vi.waitFor(() => expect(encryption.requestSetup).toHaveBeenCalledTimes(1))
    // 取りやめの結果（requestSetup の false）がフォームに届くのを待つ。
    await new Promise((resolve) => setTimeout(resolve, 0))

    // 名前は書き換えずに、もう一度確定すると初期設定を求め直す。
    fireEvent.submit(screen.getByTestId('channel-name-input').closest('form')!)
    await vi.waitFor(() => expect(encryption.requestSetup).toHaveBeenCalledTimes(2))
    expect(create).not.toHaveBeenCalled()
    await new Promise((resolve) => setTimeout(resolve, 0))

    // 暗号化をやめれば、同じ名前で非暗号化チャネルとして作れる。
    fireEvent.click(screen.getByTestId('channel-encrypted-toggle'))
    fireEvent.submit(screen.getByTestId('channel-name-input').closest('form')!)
    await vi.waitFor(() =>
      expect(create).toHaveBeenCalledWith(expect.objectContaining({ name: 'secret', encrypted: false }), expect.anything()),
    )
  })

  it('リネームの入力には暗号化の切り替えが無い', () => {
    render(<ChannelTree />)
    fireEvent.doubleClick(screen.getByTestId('channel-inbox'))
    expect(screen.queryByTestId('channel-encrypted-toggle')).toBeNull()
  })
})
