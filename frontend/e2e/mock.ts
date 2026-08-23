import { test as base, type Page } from '@playwright/test'

type Channel = {
  id: string
  parentId: string | null
  name: string
  sortKey: string
  createdAt: string
  updatedAt: string
}

type Post = {
  id: string
  channelId: string
  threadRootId: string | null
  authorId: string
  body: string
  createdAt: string
  updatedAt: string
  editedAt: string | null
  deleted: boolean
  deletedAt?: string | null
  replyCount: number
  lastReplyAt: string | null
  attachments: unknown[]
  reactions: Reaction[]
}

type Emoji = {
  id: string
  shortcode: string
  imagePath: string
  checksum: string
}

type Reaction = {
  emoji: Emoji
  count: number
  reactedByMe: boolean
  reactorIds: string[]
}

type ChangeEvent = {
  id: string
  eventType: string
  channelId?: string | null
  postId?: string | null
  threadRootId?: string | null
  createdAt: string
}

type MockBrowserBridge = Window & {
  __postallEmitEvent: (event: ChangeEvent) => void
  __postallSetOnline: (online: boolean) => void
}

function now() {
  return new Date().toISOString()
}

export async function installApiMock(page: Page) {
  await page.addInitScript(() => {
    const controllers = new Set<ReadableStreamDefaultController<Uint8Array>>()
    const encoder = new TextEncoder()
    let online = true
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      get: () => online,
    })
    const bridge = window as MockBrowserBridge
    bridge.__postallEmitEvent = (event) => {
      const frame = `id: ${event.id}\nevent: ${event.eventType}\ndata: ${JSON.stringify(event)}\n\n`
      for (const controller of [...controllers]) {
        try {
          controller.enqueue(encoder.encode(frame))
        } catch {
          controllers.delete(controller)
        }
      }
    }
    bridge.__postallSetOnline = (next) => {
      online = next
      if (!next) {
        for (const controller of [...controllers]) {
          try {
            controller.error(new TypeError('mock connection lost'))
          } catch {
            // The stream may already be closed.
          }
        }
        controllers.clear()
      }
      window.dispatchEvent(new Event(next ? 'online' : 'offline'))
    }
    const nativeFetch = window.fetch.bind(window)
    window.fetch = async (input, init) => {
      const requestUrl = new URL(input instanceof Request ? input.url : String(input), window.location.href)
      if (requestUrl.pathname === '/v1/events/stream') {
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            controllers.add(controller)
          },
          cancel() {
            // parseSseStream cancels readers on AbortSignal; closed controllers are removed on emit.
          },
        })
        return new Response(stream, {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
        })
      }
      return nativeFetch(input, init)
    }
  })

  const emojis: Emoji[] = [
    {
      id: '11111111-1111-1111-1111-111111111111',
      shortcode: 'shipit',
      imagePath: '/v1/emojis/shipit/image',
      checksum: 'sum-shipit',
    },
    {
      id: '22222222-2222-2222-2222-222222222222',
      shortcode: 'party',
      imagePath: '/v1/emojis/party/image',
      checksum: 'sum-party',
    },
    {
      id: '33333333-3333-3333-3333-333333333333',
      shortcode: 'fail',
      imagePath: '/v1/emojis/fail/image',
      checksum: 'sum-fail',
    },
  ]
  const db = {
    channels: [] as Channel[],
    posts: [] as Post[],
    events: [] as ChangeEvent[],
  }
  let connected = true
  let nextEventId = 1

  const emitEvent = async (event: ChangeEvent) => {
    if (!connected || page.isClosed()) return
    await page.evaluate((item) => {
      ;(window as MockBrowserBridge).__postallEmitEvent(item)
    }, event)
  }

  const recordEvent = async (event: Omit<ChangeEvent, 'id' | 'createdAt'>) => {
    const stored: ChangeEvent = { ...event, id: String(nextEventId++), createdAt: now() }
    db.events.push(stored)
    await emitEvent(stored)
    return stored
  }

  await page.route('**/health', async (route) => {
    await route.fulfill(
      connected
        ? { json: { status: 'ok', database: 'ok' } }
        : { status: 503, json: { status: 'unhealthy', database: 'unreachable' } },
    )
  })

  await page.route('**/v1/**', async (route) => {
    const req = route.request()
    const url = new URL(req.url())
    const method = req.method()
    const json = async () => {
      const raw = req.postData()
      return raw ? JSON.parse(raw) : {}
    }

    if (url.pathname === '/v1/events/stream' && method === 'GET') {
      await route.fulfill({
        contentType: 'text/event-stream',
        body: ': mock stream fallback\n\n',
      })
      return
    }
    if (url.pathname === '/v1/events' && method === 'GET') {
      const after = BigInt(url.searchParams.get('after') ?? '0')
      const limit = Math.min(Number(url.searchParams.get('limit') ?? 200), 200)
      const remaining = db.events.filter((event) => BigInt(event.id) > after)
      const events = remaining.slice(0, limit)
      await route.fulfill({
        json: {
          events,
          nextAfter: events.at(-1)?.id ?? after.toString(),
          hasMore: remaining.length > events.length,
        },
      })
      return
    }
    if (url.pathname === '/v1/search' && method === 'GET') {
      const query = (url.searchParams.get('q') ?? '').toLocaleLowerCase()
      const channelId = url.searchParams.get('channelId')
      const createdFrom = url.searchParams.get('createdFrom')
      const createdTo = url.searchParams.get('createdTo')
      const limit = Math.min(Number(url.searchParams.get('limit') ?? 20), 50)
      const offset = Number(url.searchParams.get('cursor') ?? 0)
      const matches = db.posts
        .filter((post) => !post.deletedAt && post.body.toLocaleLowerCase().includes(query))
        .filter((post) => !channelId || post.channelId === channelId)
        .filter((post) => !createdFrom || post.createdAt >= createdFrom)
        .filter((post) => !createdTo || post.createdAt <= createdTo)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
      const selected = matches.slice(offset, offset + limit)
      await route.fulfill({
        json: {
          results: selected.map((post) => ({
            postId: post.id,
            timelinePostId: post.threadRootId ?? post.id,
            channelId: post.channelId,
            channelName: db.channels.find((channel) => channel.id === post.channelId)?.name ?? 'unknown',
            threadRootId: post.threadRootId,
            body: post.body,
            createdAt: post.createdAt,
          })),
          nextCursor: offset + selected.length < matches.length ? String(offset + selected.length) : null,
        },
      })
      return
    }

    if (url.pathname === '/v1/channels' && method === 'GET') {
      await route.fulfill({ json: { channels: db.channels } })
      return
    }
    if (url.pathname === '/v1/emojis' && method === 'GET') {
      await route.fulfill({ json: { emojis } })
      return
    }
    const emojiImage = url.pathname.match(/^\/v1\/emojis\/([^/]+)\/image$/)
    if (emojiImage && method === 'GET') {
      const emoji = emojis.find((item) => item.shortcode === decodeURIComponent(emojiImage[1]!))
      if (!emoji) {
        await route.fulfill({ status: 404, json: { code: 'not_found', message: 'missing' } })
        return
      }
      await route.fulfill({
        contentType: 'image/png',
        body: Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
          'base64',
        ),
      })
      return
    }
    if (url.pathname === '/v1/channels' && method === 'POST') {
      const body = await json()
      if (db.channels.some((c) => c.parentId === (body.parentId ?? null) && c.name === body.name)) {
        await route.fulfill({ status: 409, json: { code: 'name_conflict', message: 'conflict' } })
        return
      }
      const ch: Channel = {
        id: crypto.randomUUID(),
        parentId: body.parentId ?? null,
        name: body.name,
        sortKey: String(db.channels.length),
        createdAt: now(),
        updatedAt: now(),
      }
      db.channels.push(ch)
      await route.fulfill({ status: 201, json: ch })
      return
    }
    const move = url.pathname.match(/^\/v1\/channels\/([^/]+)\/move$/)
    if (move && method === 'POST') {
      const body = await json()
      const ch = db.channels.find((c) => c.id === move[1])
      if (!ch) {
        await route.fulfill({ status: 404, json: { code: 'not_found', message: 'missing' } })
        return
      }
      ch.parentId = body.parentId ?? null
      ch.sortKey = `${Date.now()}`
      await route.fulfill({ json: ch })
      return
    }
    const postsPath = url.pathname.match(/^\/v1\/channels\/([^/]+)\/posts$/)
    if (postsPath && method === 'GET') {
      const channelId = postsPath[1]
      const list = db.posts
        .filter((p) => p.channelId === channelId && !p.threadRootId && !p.deletedAt)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
      const around = url.searchParams.get('around')
      const targetIndex = around ? list.findIndex((post) => post.id === around) : -1
      const posts = targetIndex >= 0
        ? list.slice(Math.max(0, targetIndex - 9), targetIndex + 1)
        : list.slice(-10)
      await route.fulfill({ json: { posts, nextBefore: null } })
      return
    }
    if (postsPath && method === 'POST') {
      const body = await json()
      const post: Post = {
        id: crypto.randomUUID(),
        channelId: postsPath[1],
        threadRootId: null,
        authorId: 'user',
        body: body.body,
        createdAt: now(),
        updatedAt: now(),
        editedAt: null,
        deleted: false,
        replyCount: 0,
        lastReplyAt: null,
        attachments: [],
        reactions: [],
      }
      db.posts.push(post)
      await route.fulfill({ status: 201, json: post })
      return
    }
    const replies = url.pathname.match(/^\/v1\/posts\/([^/]+)\/replies$/)
    if (replies && method === 'POST') {
      const body = await json()
      const parent = db.posts.find((p) => p.id === replies[1])
      if (!parent) {
        await route.fulfill({ status: 404, json: { code: 'not_found', message: 'missing' } })
        return
      }
      const rootId = parent.threadRootId ?? parent.id
      const post: Post = {
        id: crypto.randomUUID(),
        channelId: parent.channelId,
        threadRootId: rootId,
        authorId: 'user',
        body: body.body,
        createdAt: now(),
        updatedAt: now(),
        editedAt: null,
        deleted: false,
        replyCount: 0,
        lastReplyAt: null,
        attachments: [],
        reactions: [],
      }
      db.posts.push(post)
      const root = db.posts.find((p) => p.id === rootId)
      if (root) {
        root.replyCount += 1
        root.lastReplyAt = post.createdAt
      }
      await route.fulfill({ status: 201, json: post })
      return
    }
    const thread = url.pathname.match(/^\/v1\/posts\/([^/]+)\/thread$/)
    if (thread && method === 'GET') {
      const target = db.posts.find((p) => p.id === thread[1])
      if (!target) {
        await route.fulfill({ status: 404, json: { code: 'not_found', message: 'missing' } })
        return
      }
      const rootId = target.threadRootId ?? target.id
      const root = db.posts.find((p) => p.id === rootId)!
      const repliesList = db.posts.filter((p) => p.threadRootId === rootId && !p.deletedAt)
      await route.fulfill({ json: { root: { ...root, deleted: Boolean(root.deletedAt) }, replies: repliesList } })
      return
    }

    const reactionPath = url.pathname.match(/^\/v1\/posts\/([^/]+)\/reactions\/([^/]+)$/)
    if (reactionPath && (method === 'PUT' || method === 'DELETE')) {
      const post = db.posts.find((item) => item.id === reactionPath[1])
      const emoji = emojis.find((item) => item.id === reactionPath[2])
      if (!post || !emoji) {
        await route.fulfill({ status: 404, json: { code: 'not_found', message: 'missing' } })
        return
      }
      if (method === 'PUT' && emoji.shortcode === 'fail') {
        await new Promise((resolve) => setTimeout(resolve, 300))
        await route.fulfill({ status: 500, json: { code: 'rejected', message: 'failed' } })
        return
      }
      const existing = post.reactions.find((item) => item.emoji.id === emoji.id)
      if (method === 'PUT') {
        if (existing) {
          if (!existing.reactedByMe) {
            existing.count += 1
            existing.reactedByMe = true
            existing.reactorIds.unshift('e2e-user')
          }
          await route.fulfill({ json: existing })
          return
        }
        const reaction: Reaction = {
          emoji,
          count: 1,
          reactedByMe: true,
          reactorIds: ['e2e-user'],
        }
        post.reactions.push(reaction)
        await route.fulfill({ json: reaction })
        return
      }
      if (existing?.reactedByMe) {
        existing.count -= 1
        existing.reactedByMe = false
        existing.reactorIds = existing.reactorIds.filter((id) => id !== 'e2e-user')
        if (existing.count === 0) {
          post.reactions = post.reactions.filter((item) => item.emoji.id !== emoji.id)
        }
      }
      await route.fulfill({ status: 204, body: '' })
      return
    }

    const channelIdPath = url.pathname.match(/^\/v1\/channels\/([^/]+)$/)
    if (channelIdPath && method === 'PATCH') {
      const body = await json()
      const ch = db.channels.find((c) => c.id === channelIdPath[1])
      if (!ch) {
        await route.fulfill({ status: 404, json: { code: 'not_found', message: 'missing' } })
        return
      }
      if (db.channels.some((c) => c.id !== ch.id && c.parentId === ch.parentId && c.name === body.name)) {
        await route.fulfill({ status: 409, json: { code: 'name_conflict', message: 'conflict' } })
        return
      }
      ch.name = body.name
      ch.updatedAt = now()
      await route.fulfill({ json: ch })
      return
    }
    if (channelIdPath && method === 'DELETE') {
      const ch = db.channels.find((c) => c.id === channelIdPath[1])
      if (!ch) {
        await route.fulfill({ status: 404, json: { code: 'not_found', message: 'missing' } })
        return
      }
      const count = db.posts.filter((p) => p.channelId === ch.id && !p.deletedAt).length
      if (count > 0) {
        await route.fulfill({
          status: 409,
          json: { code: 'channel_has_posts', message: 'has posts', details: { count } },
        })
        return
      }
      db.channels = db.channels.filter((c) => c.id !== ch.id)
      await route.fulfill({ status: 204, body: '' })
      return
    }
    const postIdPath = url.pathname.match(/^\/v1\/posts\/([^/]+)$/)
    if (postIdPath && method === 'PATCH') {
      const body = await json()
      const post = db.posts.find((p) => p.id === postIdPath[1])
      if (!post) {
        await route.fulfill({ status: 404, json: { code: 'not_found', message: 'missing' } })
        return
      }
      post.body = body.body
      post.editedAt = now()
      post.updatedAt = post.editedAt
      await route.fulfill({ json: post })
      return
    }
    if (postIdPath && method === 'DELETE') {
      const post = db.posts.find((p) => p.id === postIdPath[1])
      if (!post) {
        await route.fulfill({ status: 404, json: { code: 'not_found', message: 'missing' } })
        return
      }
      post.deletedAt = now()
      post.deleted = true
      await route.fulfill({ status: 204, body: '' })
      return
    }

    await route.fulfill({ status: 404, json: { code: 'not_found', message: url.pathname } })
  })

  const createSeedPost = (
    channelId: string,
    body: string,
    createdAt: string,
    threadRootId: string | null = null,
  ): Post => {
    const post: Post = {
      id: crypto.randomUUID(),
      channelId,
      threadRootId,
      authorId: 'external-user',
      body,
      createdAt,
      updatedAt: createdAt,
      editedAt: null,
      deleted: false,
      replyCount: 0,
      lastReplyAt: null,
      attachments: [],
      reactions: [],
    }
    db.posts.push(post)
    return post
  }

  const seedChannel = (name: string, bodies: string[] = []) => {
    const channel: Channel = {
      id: crypto.randomUUID(),
      parentId: null,
      name,
      sortKey: String(db.channels.length),
      createdAt: now(),
      updatedAt: now(),
    }
    db.channels.push(channel)
    const posts = bodies.map((body, index) => createSeedPost(
      channel.id,
      body,
      new Date(Date.UTC(2026, 7, 23, 0, index)).toISOString(),
    ))
    return { channel, posts }
  }

  return {
    seedChannel,
    seedSearchScenario() {
      const { channel } = seedChannel('検索メモ')
      const root = createSeedPost(channel.id, '日本語の検索対象メモ', '2026-08-23T00:00:00.000Z')
      const reply = createSeedPost(channel.id, '返信検索対象の本文', '2026-08-23T00:01:00.000Z', root.id)
      root.replyCount = 1
      root.lastReplyAt = reply.createdAt
      for (let index = 0; index < 12; index += 1) {
        createSeedPost(
          channel.id,
          `新しい通常メモ ${index}`,
          new Date(Date.UTC(2026, 7, 23, 1, index)).toISOString(),
        )
      }
      return { channel, root, reply }
    },
    async createExternalPost(channelId: string, body: string) {
      const post = createSeedPost(channelId, body, now())
      await recordEvent({ eventType: 'post.created', channelId, postId: post.id, threadRootId: null })
      return post
    },
    async disconnect() {
      connected = false
      await page.evaluate(() => {
        ;(window as MockBrowserBridge).__postallSetOnline(false)
      })
    },
    async reconnect() {
      connected = true
      await page.evaluate(() => {
        ;(window as MockBrowserBridge).__postallSetOnline(true)
      })
    },
  }
}

export const test = base
export { expect } from '@playwright/test'
