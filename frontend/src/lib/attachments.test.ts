import { describe, expect, it } from 'vitest'
import { ACCEPT_ATTR, checkAttachment, inferMime, MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS } from './attachments'

describe('attachments', () => {
  it('rejects files over the size limit', () => {
    const result = checkAttachment({ type: 'image/png', size: MAX_ATTACHMENT_BYTES + 1 }, 0)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toContain('25 MiB')
  })

  it('rejects more than 10 files', () => {
    const result = checkAttachment({ type: 'image/png', size: 10 }, MAX_ATTACHMENTS)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toContain('10')
  })

  it('rejects disallowed mime types', () => {
    const result = checkAttachment({ type: 'application/x-msdownload', size: 10 }, 0)
    expect(result.ok).toBe(false)
  })

  it('infers mime from the file extension', () => {
    expect(inferMime('photo.JPG', '')).toBe('image/jpeg')
    expect(inferMime('notes.md', '')).toBe('text/markdown')
    expect(inferMime('notes.markdown', '')).toBe('text/markdown')
    expect(inferMime('notes.md', 'text/x-markdown')).toBe('text/markdown')
  })

  it('lists file extensions in the picker accept attribute', () => {
    const accept = ACCEPT_ATTR.split(',')
    expect(accept).toContain('.md')
    expect(accept).toContain('.markdown')
    expect(accept).toContain('text/markdown')
  })
})
