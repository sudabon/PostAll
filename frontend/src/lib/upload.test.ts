import { describe, expect, it, vi } from 'vitest'
import { uploadPickedFile } from './upload'

vi.mock('./attachments', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./attachments')>()
  return { ...actual, sha256Hex: vi.fn().mockResolvedValue('checksum') }
})

describe('uploadPickedFile', () => {
  it('PUTs file bytes through putBytes instead of talking to storage from the renderer', async () => {
    const putBytes = vi.fn().mockResolvedValue(undefined)
    const api = {
      startUpload: vi.fn().mockResolvedValue({
        id: 'att-1',
        uploadUrl: 'https://storage.example/put',
        headers: { 'Content-Type': 'image/png', 'Content-Length': '3' },
      }),
      completeUpload: vi.fn().mockResolvedValue({}),
    }
    const data = new Uint8Array([1, 2, 3]).buffer
    const id = await uploadPickedFile(
      api as never,
      { name: 'a.png', type: 'image/png', data },
      () => {},
      putBytes,
    )
    expect(id).toBe('att-1')
    expect(putBytes).toHaveBeenCalledWith(
      'https://storage.example/put',
      data,
      { 'Content-Type': 'image/png', 'Content-Length': '3' },
      expect.any(Function),
    )
    expect(api.completeUpload).toHaveBeenCalledWith('att-1')
  })
})
