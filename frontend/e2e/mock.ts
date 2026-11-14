import { test as base, type Page } from '@playwright/test'

type Channel = {
  id: string
  parentId: string | null
  name: string
  sortKey: string
  encrypted: boolean
  createdAt: string
  updatedAt: string
}

type Post = {
  id: string
  channelId: string
  threadRootId: string | null
  authorId: string
  body: string
  encrypted: boolean
  ciphertext: string | null
  createdAt: string
  updatedAt: string
  editedAt: string | null
  deleted: boolean
  deletedAt?: string | null
  replyCount: number
  lastReplyAt: string | null
  attachments: Attachment[]
  reactions: Reaction[]
}

type Attachment = {
  id: string
  postId: string | null
  fileName: string
  contentType: string
  sizeBytes: number
  checksum: string
  createdAt: string
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

/** 1x1 の透過画像。アップロードされたスタンプの配信に使う。 */
const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
)
const ONE_PIXEL_GIF = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64',
)

/** mock:rich-content-post のポスト本文。コードブロックと Mermaid 図を含む。 */
export const RICH_CONTENT_BODY = [
  'リッチコンテンツの確認',
  '',
  '```ts',
  'const answer: number = 42',
  '```',
  '',
  '```mermaid',
  'graph TD',
  '  A[開始] --> B[終了]',
  '```',
].join('\n')

/** mock:rich-content-post の画像添付。ダウンロード URL は同一オリジンのモック画像を指す。 */
export const RICH_CONTENT_IMAGE = {
  id: '55555555-5555-5555-5555-555555555555',
  fileName: 'rich-content.png',
  url: '/e2e-assets/rich-content.png',
}

export type V1Request = {
  method: string
  path: string
  authorization: string | null
  /** 全ヘッダー（小文字の名前）。暗号化の要求に平文や鍵が混ざっていないかを検査する */
  headers: Record<string, string>
  /** 本文。暗号化の要求に平文や鍵が混ざっていないかを検査する */
  body: string | null
}

export type MockKeyring = {
  keyId: string
  keyProof: string
  passphraseWrap: unknown
  recoveryWrap: unknown
}

/** mock:account-not-allowed が端末の永続ストレージに置く、拒否されるトークン。 */
export const REJECTED_ACCESS_TOKEN = 'rejected-access-token'
const DURABLE_TOKEN_KEY = 'postall:secret:auth.tokens'

export type ApiMockOptions = {
  /** カタログを空の状態から始める。fixture 名: mock:signed-in-empty-catalog */
  emptyEmojiCatalog?: boolean
  /**
   * サインイン済みの状態から、全 /v1/* に 403 account_not_allowed を返す。
   * fixture 名: mock:account-not-allowed
   */
  accountNotAllowed?: boolean
  /**
   * コードブロック・Mermaid 図・画像添付を 1 つのポストに含むチャネル `rich` を作る。
   * fixture 名: mock:rich-content-post
   */
  richContentPost?: boolean
  /**
   * 暗号化チャネルと鍵束。未指定なら鍵束は未設定。
   * conflict は、登録の POST が 409 になり、その後の GET で既存の鍵束を返す。
   */
  encryption?: {
    keyring?: MockKeyring
    conflict?: boolean
  }
  /**
   * スタンプ登録要求への応答。
   * mock:emoji-upload-conflict / mock:emoji-upload-error / mock:emoji-upload-slow
   */
  emojiUpload?: 'success' | 'conflict' | 'error' | 'slow'
}

/** multipart/form-data の本文から 1 つのフィールドの値を取り出す。 */
function multipartField(body: string, name: string): string {
  const match = body.match(new RegExp(`name="${name}"\\r\\n\\r\\n([\\s\\S]*?)\\r\\n--`))
  return match?.[1] ?? ''
}

/** file パートの filename を取り出す。 */
function multipartFileName(body: string): string {
  return body.match(/name="file"; filename="([^"]*)"/)?.[1] ?? ''
}

export async function installApiMock(page: Page, options: ApiMockOptions = {}) {
  await page.addInitScript(() => {
    let online = true
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      get: () => online,
    })
    const bridge = window as MockBrowserBridge
    bridge.__postallEmitEvent = (event) => {
      window.dispatchEvent(new CustomEvent('postall:change-signal', { detail: event }))
    }
    bridge.__postallSetOnline = (next) => {
      online = next
      window.dispatchEvent(new Event(next ? 'online' : 'offline'))
    }
  })

  if (options.accountNotAllowed) {
    // トークンの破棄を観測できるよう、拒否されるトークンを端末の永続ストレージにも置く。
    await page.addInitScript(
      ([key, accessToken]) => {
        localStorage.setItem(key, JSON.stringify({
          accessToken,
          refreshToken: 'rejected-refresh-token',
          expiresAt: Date.now() + 60 * 60 * 1000,
        }))
      },
      [DURABLE_TOKEN_KEY, REJECTED_ACCESS_TOKEN] as const,
    )
  }

  const emojis: Emoji[] = options.emptyEmojiCatalog
    ? []
    : [
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
  // 登録されたスタンプの配信形式。アップロードされたファイル名から決める。
  const uploadedKinds = new Map<string, 'png' | 'gif'>()
  const uploadMode = options.emojiUpload ?? 'success'
  let emojiUploadRequests = 0
  let releaseEmojiUpload: (() => void) | undefined
  const emojiUploadGate = uploadMode === 'slow'
    ? new Promise<void>((resolve) => {
      releaseEmojiUpload = resolve
    })
    : null
  let nextEmojiId = 100
  const db = {
    channels: [] as Channel[],
    posts: [] as Post[],
    events: [] as ChangeEvent[],
  }
  let connected = true
  let nextEventId = 1
  // 楽観的更新の失敗経路を試すための一発限りの拒否。再送・再試行はそのまま成功させたいので
  // 件数で持ち、使うたびに減らす。
  let rejectedCreates = 0
  let rejectedDeletes = 0
  const v1Requests: V1Request[] = []
  let keyring: MockKeyring | null = options.encryption?.keyring ?? null
  let hideKeyring = Boolean(options.encryption?.conflict)
  const envelopeKey = (ciphertext: string) =>
    /^pe1\.([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]+$/.exec(ciphertext)?.[1] ?? null
  const checkedContent = async (
    reject: (status: number, code: string) => Promise<void>,
    encrypted: boolean,
    body: { body?: string; ciphertext?: string; attachmentIds?: string[] },
  ) => {
    const text = body.body ?? ''
    const attachments = body.attachmentIds ?? []
    if (!encrypted) {
      if (body.ciphertext) {
        await reject(400, 'encryption_not_allowed')
        return null
      }
      if (!text.trim() && attachments.length === 0) {
        await reject(400, 'empty_content')
        return null
      }
      return { body: text, ciphertext: null as string | null }
    }
    if (!keyring) {
      await reject(409, 'encryption_not_configured')
      return null
    }
    if (body.ciphertext == null || text !== '') {
      await reject(400, 'encryption_required')
      return null
    }
    if (attachments.length > 0) {
      await reject(400, 'encrypted_attachments_unsupported')
      return null
    }
    if (envelopeKey(body.ciphertext) !== keyring.keyId) {
      await reject(400, 'invalid_ciphertext')
      return null
    }
    return { body: '', ciphertext: body.ciphertext }
  }

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

  await page.route('**/e2e-assets/**', async (route) => {
    await route.fulfill({ contentType: 'image/png', body: ONE_PIXEL_PNG })
  })

  // アプリを読み込まずに、同じオリジンのストレージを準備するための空のページ。
  await page.route('**/__e2e__/blank', async (route) => {
    await route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>blank</title>' })
  })

  await page.route('**/v1/**', async (route) => {
    const req = route.request()
    const url = new URL(req.url())
    const method = req.method()
    const json = async () => {
      const raw = req.postData()
      return raw ? JSON.parse(raw) : {}
    }
    const rejectContent = async (status: number, code: string) => {
      await route.fulfill({ status, json: { code, message: code } })
    }
    const rawBody = req.postData()
    const headers = await req.allHeaders()
    v1Requests.push({
      method,
      path: `${url.pathname}${url.search}`,
      authorization: headers.authorization ?? null,
      headers,
      body: rawBody,
    })

    if (options.accountNotAllowed) {
      await route.fulfill({
        status: 403,
        json: { code: 'account_not_allowed', message: 'このアカウントでは利用が許可されていません' },
      })
      return
    }

    if (url.pathname === '/v1/events' && method === 'GET') {
      const requestedAfter = url.searchParams.get('after') ?? '0'
      const after = requestedAfter === 'latest'
        ? BigInt(db.events.at(-1)?.id ?? '0')
        : BigInt(requestedAfter)
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
    if (url.pathname === '/v1/encryption/keyring' && method === 'GET') {
      if (!keyring || hideKeyring) {
        await route.fulfill({ status: 404, json: { code: 'encryption_not_configured', message: '暗号化の鍵が設定されていません' } })
        return
      }
      await route.fulfill({
        json: { ...keyring, createdAt: now(), updatedAt: now() },
      })
      return
    }
    if (url.pathname === '/v1/encryption/keyring' && method === 'POST') {
      const body = await json()
      if (hideKeyring) {
        hideKeyring = false
        await route.fulfill({ status: 409, json: { code: 'encryption_already_configured', message: '暗号化の鍵は既に設定されています' } })
        return
      }
      if (keyring) {
        await route.fulfill({ status: 409, json: { code: 'encryption_already_configured', message: '暗号化の鍵は既に設定されています' } })
        return
      }
      keyring = {
        keyId: body.keyId,
        keyProof: body.keyProof,
        passphraseWrap: body.passphraseWrap,
        recoveryWrap: body.recoveryWrap,
      }
      await route.fulfill({ status: 201, json: { ...keyring, createdAt: now(), updatedAt: now() } })
      return
    }
    const wrapPath = url.pathname.match(/^\/v1\/encryption\/keyring\/(passphrase|recovery)$/)
    if (wrapPath && method === 'PUT') {
      if (!keyring) {
        await route.fulfill({ status: 404, json: { code: 'encryption_not_configured', message: '暗号化の鍵が設定されていません' } })
        return
      }
      const proof = (await req.allHeaders())['x-postall-key-proof']
      if (!proof || proof !== keyring.keyProof) {
        await route.fulfill({ status: 403, json: { code: 'key_proof_mismatch', message: '鍵の所持を確認できませんでした' } })
        return
      }
      const body = await json()
      if (wrapPath[1] === 'passphrase') keyring = { ...keyring, passphraseWrap: body }
      else keyring = { ...keyring, recoveryWrap: body }
      await route.fulfill({ json: { ...keyring, createdAt: now(), updatedAt: now() } })
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
        .filter((post) => !post.deletedAt && !post.encrypted && post.body.toLocaleLowerCase().includes(query))
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
    if (url.pathname === '/v1/emojis' && method === 'POST') {
      emojiUploadRequests += 1
      const body = req.postData() ?? ''
      const shortcode = multipartField(body, 'shortcode')
      if (uploadMode === 'conflict') {
        await route.fulfill({
          status: 409,
          json: {
            code: 'shortcode_conflict',
            message: `:${shortcode}: は既に登録されています。別のショートコードにしてください`,
          },
        })
        return
      }
      if (uploadMode === 'error') {
        await route.fulfill({
          status: 500,
          json: { code: 'internal', message: '想定外のエラーが発生しました' },
        })
        return
      }
      if (emojiUploadGate) await emojiUploadGate
      const created: Emoji = {
        id: `44444444-4444-4444-4444-${String(nextEmojiId++).padStart(12, '0')}`,
        shortcode,
        imagePath: `/v1/emojis/${encodeURIComponent(shortcode)}/image`,
        checksum: `sum-${shortcode}`,
      }
      emojis.push(created)
      uploadedKinds.set(shortcode, multipartFileName(body).toLowerCase().endsWith('.gif') ? 'gif' : 'png')
      await route.fulfill({ status: 201, json: created })
      return
    }
    const emojiImage = url.pathname.match(/^\/v1\/emojis\/([^/]+)\/image$/)
    if (emojiImage && method === 'GET') {
      const emoji = emojis.find((item) => item.shortcode === decodeURIComponent(emojiImage[1]!))
      if (!emoji) {
        await route.fulfill({ status: 404, json: { code: 'not_found', message: 'missing' } })
        return
      }
      const kind = uploadedKinds.get(emoji.shortcode) ?? 'png'
      await route.fulfill({
        contentType: kind === 'gif' ? 'image/gif' : 'image/png',
        body: kind === 'gif' ? ONE_PIXEL_GIF : ONE_PIXEL_PNG,
      })
      return
    }
    if (url.pathname === '/v1/channels' && method === 'POST') {
      const body = await json()
      if (db.channels.some((c) => c.parentId === (body.parentId ?? null) && c.name === body.name)) {
        await route.fulfill({ status: 409, json: { code: 'name_conflict', message: 'conflict' } })
        return
      }
      if (body.encrypted && !keyring) {
        await route.fulfill({ status: 409, json: { code: 'encryption_not_configured', message: '暗号化の鍵が設定されていません' } })
        return
      }
      const ch: Channel = {
        id: crypto.randomUUID(),
        parentId: body.parentId ?? null,
        name: body.name,
        sortKey: String(db.channels.length),
        encrypted: Boolean(body.encrypted),
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
      if (rejectedCreates > 0) {
        rejectedCreates -= 1
        await route.fulfill({ status: 500, json: { code: 'rejected', message: 'create failed' } })
        return
      }
      const body = await json()
      const channel = db.channels.find((item) => item.id === postsPath[1])
      const content = await checkedContent(rejectContent, Boolean(channel?.encrypted), body)
      if (!content) return
      const post: Post = {
        id: crypto.randomUUID(),
        channelId: postsPath[1],
        threadRootId: null,
        authorId: 'user',
        body: content.body,
        encrypted: Boolean(channel?.encrypted),
        ciphertext: content.ciphertext,
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
      if (rejectedCreates > 0) {
        rejectedCreates -= 1
        await route.fulfill({ status: 500, json: { code: 'rejected', message: 'create failed' } })
        return
      }
      const body = await json()
      const parent = db.posts.find((p) => p.id === replies[1])
      if (!parent) {
        await route.fulfill({ status: 404, json: { code: 'not_found', message: 'missing' } })
        return
      }
      const content = await checkedContent(rejectContent, parent.encrypted, body)
      if (!content) return
      const rootId = parent.threadRootId ?? parent.id
      const post: Post = {
        id: crypto.randomUUID(),
        channelId: parent.channelId,
        threadRootId: rootId,
        authorId: 'user',
        body: content.body,
        encrypted: parent.encrypted,
        ciphertext: content.ciphertext,
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

    const download = url.pathname.match(/^\/v1\/attachments\/([^/]+)\/download$/)
    if (download && method === 'GET') {
      const attachment = db.posts.flatMap((post) => post.attachments).find((item) => item.id === download[1])
      if (!attachment) {
        await route.fulfill({ status: 404, json: { code: 'not_found', message: 'missing' } })
        return
      }
      await route.fulfill({
        json: { url: RICH_CONTENT_IMAGE.url, expiresAt: new Date(Date.now() + 60_000).toISOString() },
      })
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
      const content = await checkedContent(rejectContent, post.encrypted, body)
      if (!content) return
      post.body = content.body
      post.ciphertext = content.ciphertext
      if (Array.isArray(body.attachmentIds)) {
        post.attachments = post.attachments.filter((attachment) => body.attachmentIds.includes(attachment.id))
      }
      post.editedAt = now()
      post.updatedAt = post.editedAt
      await route.fulfill({ json: post })
      return
    }
    if (postIdPath && method === 'DELETE') {
      if (rejectedDeletes > 0) {
        rejectedDeletes -= 1
        await route.fulfill({ status: 500, json: { code: 'rejected', message: 'delete failed' } })
        return
      }
      const post = db.posts.find((p) => p.id === postIdPath[1])
      if (!post) {
        await route.fulfill({ status: 404, json: { code: 'not_found', message: 'missing' } })
        return
      }
      post.deletedAt = now()
      post.deleted = true
      post.body = ''
      post.ciphertext = null
      if (post.threadRootId) {
        const root = db.posts.find((item) => item.id === post.threadRootId)
        if (root) {
          const remaining = db.posts.filter((item) => item.threadRootId === root.id && !item.deletedAt)
          root.replyCount = remaining.length
          root.lastReplyAt = remaining.at(-1)?.createdAt ?? null
        }
      }
      await route.fulfill({ status: 204, body: '' })
      return
    }

    await route.fulfill({ status: 404, json: { code: 'not_found', message: url.pathname } })
  })

  /** content が { ciphertext } なら、別の端末が暗号化チャネルに投稿したポストとして置く。 */
  const createSeedPost = (
    channelId: string,
    content: string | { ciphertext: string },
    createdAt: string,
    threadRootId: string | null = null,
  ): Post => {
    const ciphertext = typeof content === 'string' ? null : content.ciphertext
    const post: Post = {
      id: crypto.randomUUID(),
      channelId,
      threadRootId,
      authorId: 'external-user',
      body: typeof content === 'string' ? content : '',
      encrypted: ciphertext !== null,
      ciphertext,
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

  const seedChannelWith = (name: string, contents: Array<string | { ciphertext: string }>, encrypted: boolean) => {
    const channel: Channel = {
      id: crypto.randomUUID(),
      parentId: null,
      name,
      sortKey: String(db.channels.length),
      encrypted,
      createdAt: now(),
      updatedAt: now(),
    }
    db.channels.push(channel)
    const posts = contents.map((content, index) => createSeedPost(
      channel.id,
      content,
      new Date(Date.UTC(2026, 7, 23, 0, index)).toISOString(),
    ))
    return { channel, posts }
  }
  const seedChannel = (name: string, bodies: string[] = []) => seedChannelWith(name, bodies, false)
  /** 暗号化チャネルと、その暗号文のポスト。鍵束は options.encryption.keyring で与える */
  const seedEncryptedChannel = (name: string, ciphertexts: string[] = []) =>
    seedChannelWith(name, ciphertexts.map((ciphertext) => ({ ciphertext })), true)

  if (options.richContentPost) {
    const { posts: [post] } = seedChannel('rich', [RICH_CONTENT_BODY])
    post!.attachments.push({
      id: RICH_CONTENT_IMAGE.id,
      postId: post!.id,
      fileName: RICH_CONTENT_IMAGE.fileName,
      contentType: 'image/png',
      sizeBytes: ONE_PIXEL_PNG.length,
      checksum: 'sum-rich-content',
      createdAt: post!.createdAt,
    })
  }

  return {
    /** 受けた /v1/* 要求（受けた順）。mock:account-not-allowed で拒否後の要求を数えるのに使う。 */
    v1Requests() {
      return [...v1Requests]
    },
    /** スタンプ登録要求が実際に何件飛んだか。 */
    emojiUploadRequestCount() {
      return emojiUploadRequests
    },
    /** mock:emoji-upload-slow の応答を解放する。 */
    releaseEmojiUpload() {
      releaseEmojiUpload?.()
    },
    seedChannel,
    seedEncryptedChannel,
    /** スレッドへの返信を、別の端末が投稿したものとして置く。親と同じチャネルに属する */
    seedReply(rootId: string, content: string | { ciphertext: string }) {
      const root = db.posts.find((post) => post.id === rootId)
      if (!root) throw new Error(`seedReply: ${rootId} が無い`)
      const reply = createSeedPost(
        root.channelId,
        content,
        new Date(new Date(root.createdAt).getTime() + 60_000).toISOString(),
        root.id,
      )
      root.replyCount += 1
      root.lastReplyAt = reply.createdAt
      return reply
    },
    /** 保存されているポスト（暗号化チャネルのポストは暗号文だけを持つ） */
    storedPosts() {
      return db.posts.map((post) => ({ ...post }))
    },
    /** 登録されている鍵束 */
    storedKeyring() {
      return keyring
    },
    /** 次の count 件の投稿・返信の作成をサーバーが拒否する */
    rejectNextCreates(count = 1) {
      rejectedCreates = count
    },
    /** 次の count 件の削除をサーバーが拒否する */
    rejectNextDeletes(count = 1) {
      rejectedDeletes = count
    },
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
