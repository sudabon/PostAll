import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiClient, ApiError } from './client'

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

  it('posts a stamp as multipart form data without setting Content-Type', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 'emoji-1',
          shortcode: 'uploaded',
          imagePath: '/v1/emojis/uploaded/image',
          checksum: 'sum',
        }),
        { status: 201 },
      ),
    )
    vi.stubGlobal('fetch', fetchMock)
    const api = new ApiClient(() => 'https://api.example', async () => 'token-1')
    const file = new File([new Uint8Array([1, 2, 3])], 'uploaded.png', { type: 'image/png' })

    const created = await api.createEmoji(file, 'uploaded')

    expect(created.shortcode).toBe('uploaded')
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://api.example/v1/emojis')
    const init = fetchMock.mock.calls[0]?.[1]
    expect(init?.method).toBe('POST')

    const body = init?.body as FormData
    expect(body).toBeInstanceOf(FormData)
    expect(body.get('shortcode')).toBe('uploaded')
    expect(body.get('file')).toBe(file)

    const headers = init?.headers as Headers
    expect(headers.get('Authorization')).toBe('Bearer token-1')
    // 境界文字列を含む Content-Type はブラウザが付ける。手で設定してはいけない。
    expect(headers.get('Content-Type')).toBeNull()
  })

  it('surfaces a duplicate shortcode as an ApiError with the server code', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ code: 'shortcode_conflict', message: ':shipit: は既に登録されています' }),
        { status: 409 },
      ),
    )
    vi.stubGlobal('fetch', fetchMock)
    const api = new ApiClient(() => 'https://api.example', async () => 'token')
    const file = new File([new Uint8Array([1])], 'shipit.png', { type: 'image/png' })

    const error = await api.createEmoji(file, 'shipit').catch((e: unknown) => e)

    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).status).toBe(409)
    expect((error as ApiError).code).toBe('shortcode_conflict')
    expect((error as ApiError).message).toContain('shipit')
  })
})
