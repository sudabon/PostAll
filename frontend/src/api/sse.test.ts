import { describe, expect, it, vi } from 'vitest'
import { parseSseStream } from './sse'

describe('parseSseStream', () => {
  it('parses UTF-8, fields, and line endings split across chunks', async () => {
    const bytes = new TextEncoder().encode(
      ': heartbeat\r\nid: 41\r\nevent: post.created\r\ndata: 日本語\r\ndata: second line\r\n\r\n',
    )
    const splitPoints = [1, 5, 18, 37, 52, 53, 54, 57, bytes.length - 1]
    let start = 0
    const chunks = [...splitPoints, bytes.length].map((end) => {
      const chunk = bytes.slice(start, end)
      start = end
      return chunk
    })
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk)
        controller.close()
      },
    })
    const received = vi.fn()

    await parseSseStream(stream, received)

    expect(received).toHaveBeenCalledTimes(1)
    expect(received).toHaveBeenCalledWith({
      id: '41',
      event: 'post.created',
      data: '日本語\nsecond line',
    })
  })

  it('stops cleanly when aborted while waiting for input', async () => {
    const stream = new ReadableStream<Uint8Array>({})
    const controller = new AbortController()
    const parsing = parseSseStream(stream, vi.fn(), controller.signal)

    controller.abort()

    await expect(parsing).resolves.toBeUndefined()
  })
})
