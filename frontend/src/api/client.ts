import type { components } from './schema'

export type Channel = components['schemas']['Channel']
export type Post = components['schemas']['Post']
export type Thread = components['schemas']['Thread']
export type Health = components['schemas']['Health']
export type Attachment = components['schemas']['Attachment']
export type Emoji = components['schemas']['Emoji']
export type Reaction = components['schemas']['Reaction']
export type SearchResult = components['schemas']['SearchResult']
export type SearchResultPage = components['schemas']['SearchResultPage']
export type ChangeEvent = components['schemas']['ChangeEvent']
export type ChangeEventPage = components['schemas']['ChangeEventPage']
export type ApiErrorBody = components['schemas']['Error']

export type SearchInput = {
  query: string
  channelId?: string
  createdFrom?: string
  createdTo?: string
  limit?: number
  cursor?: string
}

export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly details?: Record<string, unknown>

  constructor(status: number, body: ApiErrorBody) {
    super(body.message)
    this.status = status
    this.code = body.code
    this.details = body.details
  }
}

export type TokenGetter = () => Promise<string | null>
export type BaseGetter = () => string

export class ApiClient {
  private readonly getBase: BaseGetter
  private readonly getToken: TokenGetter

  constructor(getBase: BaseGetter, getToken: TokenGetter) {
    this.getBase = getBase
    this.getToken = getToken
  }

  getHealth() {
    return this.request<Health>('/health', { auth: false })
  }

  listChannels() {
    return this.request<{ channels: Channel[] }>('/v1/channels').then((r) => r.channels)
  }

  createChannel(body: { name: string; parentId?: string | null }) {
    return this.request<Channel>('/v1/channels', { method: 'POST', json: body })
  }

  renameChannel(id: string, name: string) {
    return this.request<Channel>(`/v1/channels/${id}`, { method: 'PATCH', json: { name } })
  }

  deleteChannel(id: string) {
    return this.request<void>(`/v1/channels/${id}`, { method: 'DELETE' })
  }

  moveChannel(
    id: string,
    body: { parentId?: string | null; beforeId?: string | null; afterId?: string | null },
  ) {
    return this.request<Channel>(`/v1/channels/${id}/move`, { method: 'POST', json: body })
  }

  listPosts(channelId: string, params?: { limit?: number; before?: string; around?: string }) {
    const q = new URLSearchParams()
    if (params?.limit) q.set('limit', String(params.limit))
    if (params?.before) q.set('before', params.before)
    if (params?.around) q.set('around', params.around)
    const suffix = q.size ? `?${q.toString()}` : ''
    return this.request<{ posts: Post[]; nextBefore?: string | null }>(
      `/v1/channels/${channelId}/posts${suffix}`,
    )
  }

  createPost(channelId: string, body: string, attachmentIds?: string[]) {
    return this.request<Post>(`/v1/channels/${channelId}/posts`, {
      method: 'POST',
      json: { body, attachmentIds },
    })
  }

  editPost(id: string, body: string) {
    return this.request<Post>(`/v1/posts/${id}`, { method: 'PATCH', json: { body } })
  }

  deletePost(id: string) {
    return this.request<void>(`/v1/posts/${id}`, { method: 'DELETE' })
  }

  getThread(postId: string) {
    return this.request<Thread>(`/v1/posts/${postId}/thread`)
  }

  createReply(postId: string, body: string, attachmentIds?: string[]) {
    return this.request<Post>(`/v1/posts/${postId}/replies`, {
      method: 'POST',
      json: { body, attachmentIds },
    })
  }

  listEmojis() {
    return this.request<components['schemas']['EmojiList']>('/v1/emojis').then((r) => r.emojis)
  }

  getEmojiImage(shortcode: string) {
    return this.fetchResponse(`/v1/emojis/${encodeURIComponent(shortcode)}/image`).then((r) => r.blob())
  }

  addReaction(postId: string, emojiId: string) {
    return this.request<Reaction>(`/v1/posts/${postId}/reactions/${emojiId}`, { method: 'PUT' })
  }

  removeReaction(postId: string, emojiId: string) {
    return this.request<void>(`/v1/posts/${postId}/reactions/${emojiId}`, { method: 'DELETE' })
  }

  searchPosts(input: SearchInput) {
    const query = new URLSearchParams({ q: input.query })
    if (input.channelId) query.set('channelId', input.channelId)
    if (input.createdFrom) query.set('createdFrom', input.createdFrom)
    if (input.createdTo) query.set('createdTo', input.createdTo)
    if (input.limit) query.set('limit', String(input.limit))
    if (input.cursor) query.set('cursor', input.cursor)
    return this.request<SearchResultPage>(`/v1/search?${query.toString()}`)
  }

  listEvents(after = '0', limit = 200) {
    const query = new URLSearchParams({ after, limit: String(limit) })
    return this.request<ChangeEventPage>(`/v1/events?${query.toString()}`)
  }

  async streamEvents(lastEventId: string | null, signal: AbortSignal) {
    const headers = new Headers({ Accept: 'text/event-stream' })
    if (lastEventId) headers.set('Last-Event-ID', lastEventId)
    const response = await this.fetchResponse('/v1/events/stream', { headers, signal })
    if (!response.body) throw new Error('イベントストリームの本文がありません')
    return response.body
  }

  startUpload(input: {
    fileName: string
    contentType: string
    sizeBytes: number
    checksum: string
  }) {
    return this.request<components['schemas']['StartUploadResponse']>('/v1/attachments/uploads', {
      method: 'POST',
      json: input,
    })
  }

  completeUpload(id: string) {
    return this.request<Attachment>(`/v1/attachments/${id}/complete`, { method: 'POST' })
  }

  getDownloadUrl(id: string) {
    return this.request<components['schemas']['DownloadUrlResponse']>(`/v1/attachments/${id}/download`)
  }

  private async request<T>(
    path: string,
    init: { method?: string; json?: unknown; auth?: boolean } = {},
  ): Promise<T> {
    const res = await this.fetchResponse(path, init)
    if (res.status === 204) return undefined as T
    const text = await res.text()
    return (text ? JSON.parse(text) : null) as T
  }

  private async fetchResponse(
    path: string,
    init: {
      method?: string
      json?: unknown
      auth?: boolean
      headers?: HeadersInit
      signal?: AbortSignal
    } = {},
  ): Promise<Response> {
    const headers = new Headers(init.headers)
    if (init.json !== undefined) headers.set('Content-Type', 'application/json')
    if (init.auth !== false) {
      const token = await this.getToken()
      if (token) headers.set('Authorization', `Bearer ${token}`)
    }
    const res = await fetch(`${this.getBase()}${path}`, {
      method: init.method ?? 'GET',
      headers,
      body: init.json !== undefined ? JSON.stringify(init.json) : undefined,
      signal: init.signal,
    })
    if (!res.ok) {
      const text = await res.text()
      let err: ApiErrorBody | null = null
      try {
        err = text ? (JSON.parse(text) as ApiErrorBody) : null
      } catch {
        // Non-JSON error bodies still use the shared HTTP error shape below.
      }
      throw new ApiError(res.status, err ?? { code: 'http_error', message: res.statusText })
    }
    return res
  }
}
