import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiClient } from './client'

describe('ApiClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('fetches an authenticated image as a blob', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { 'Content-Type': 'image/png' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const api = new ApiClient(() => 'https://api.example', async () => 'token-1')

    const result = await api.getEmojiImage('shipit')

    expect(result.type).toBe('image/png')
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example/v1/emojis/shipit/image',
      expect.objectContaining({
        headers: expect.objectContaining({}),
      }),
    )
    const headers = fetchMock.mock.calls[0]?.[1]?.headers as Headers
    expect(headers.get('Authorization')).toBe('Bearer token-1')
  })

  it('opens an authenticated SSE stream without exposing credentials in the URL', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(''))
    vi.stubGlobal('fetch', fetchMock)
    const api = new ApiClient(() => 'https://api.example', async () => 'secret-token')
    const controller = new AbortController()

    await api.streamEvents('42', controller.signal)

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example/v1/events/stream',
      expect.objectContaining({ method: 'GET', signal: controller.signal }),
    )
    const headers = fetchMock.mock.calls[0]?.[1]?.headers as Headers
    expect(headers.get('Authorization')).toBe('Bearer secret-token')
    expect(headers.get('Accept')).toBe('text/event-stream')
    expect(headers.get('Last-Event-ID')).toBe('42')
    expect(fetchMock.mock.calls[0]?.[0]).not.toContain('secret-token')
  })

  it('uses an event cursor for diff recovery', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ events: [], nextAfter: '42', hasMore: false }), { status: 200 }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const api = new ApiClient(() => 'https://api.example', async () => 'token')

    await api.listEvents('42', 200)

    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://api.example/v1/events?after=42&limit=200')
  })

  it('keeps body-only edits compatible and sends attachment IDs when selected', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const api = new ApiClient(() => 'https://api.example', async () => 'token')

    await api.editPost('post-1', 'body only')
    await api.editPost('post-1', 'with attachment', ['attachment-1'])

    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({ body: 'body only' })
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
      body: 'with attachment',
      attachmentIds: ['attachment-1'],
    })
  })
})
