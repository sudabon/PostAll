export type SseMessage = {
  id?: string
  event?: string
  data: string
}

export async function parseSseStream(
  stream: ReadableStream<Uint8Array>,
  onEvent: (message: SseMessage) => void | Promise<void>,
  signal?: AbortSignal,
): Promise<void> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let eventId: string | undefined
  let eventType: string | undefined
  let dataLines: string[] = []

  const processLine = async (line: string) => {
    if (line === '') {
      if (dataLines.length > 0) {
        const message: SseMessage = { data: dataLines.join('\n') }
        if (eventId !== undefined) message.id = eventId
        if (eventType !== undefined) message.event = eventType
        await onEvent(message)
      }
      eventId = undefined
      eventType = undefined
      dataLines = []
      return
    }
    if (line.startsWith(':')) return
    const separator = line.indexOf(':')
    const field = separator < 0 ? line : line.slice(0, separator)
    let value = separator < 0 ? '' : line.slice(separator + 1)
    if (value.startsWith(' ')) value = value.slice(1)
    if (field === 'data') dataLines.push(value)
    if (field === 'event') eventType = value
    if (field === 'id' && !value.includes('\0')) eventId = value
  }

  const drainLines = async (final: boolean) => {
    while (true) {
      let end = -1
      let separatorLength = 0
      for (let index = 0; index < buffer.length; index += 1) {
        const char = buffer[index]
        if (char === '\n') {
          end = index
          separatorLength = 1
          break
        }
        if (char === '\r') {
          if (index === buffer.length - 1 && !final) return
          end = index
          separatorLength = buffer[index + 1] === '\n' ? 2 : 1
          break
        }
      }
      if (end < 0) {
        if (final && buffer.length > 0) {
          const line = buffer
          buffer = ''
          await processLine(line)
        }
        return
      }
      const line = buffer.slice(0, end)
      buffer = buffer.slice(end + separatorLength)
      await processLine(line)
    }
  }

  const abort = () => {
    void reader.cancel(signal?.reason).catch(() => {})
  }
  if (signal?.aborted) abort()
  else signal?.addEventListener('abort', abort, { once: true })

  try {
    while (!signal?.aborted) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      await drainLines(false)
    }
    if (!signal?.aborted) {
      buffer += decoder.decode()
      await drainLines(true)
    }
  } catch (error) {
    if (!signal?.aborted) throw error
  } finally {
    signal?.removeEventListener('abort', abort)
    reader.releaseLock()
  }
}
