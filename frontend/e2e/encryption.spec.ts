import { expect, test, type Locator, type Page } from '@playwright/test'
import type { V1Request } from './mock'
import { idle, installIdleClock } from './fixtures/clock'
import {
  FOREIGN_PLAINTEXT,
  INBOX_BODY,
  NEW_PASSPHRASE,
  SECRET_INTACT_BODY,
  SECRET_THREAD_REPLY,
  SECRET_THREAD_ROOT,
  TAMPERED_PLAINTEXT,
  TEST_PASSPHRASE,
  TEST_RECOVERY_KEY,
  WRONG_PASSPHRASE,
  completeSetup,
  dumpDeviceStorage,
  installEncryptionMock,
  readRememberedKey,
  unlockWith,
} from './fixtures/encryption'

// change: add-client-side-post-encryption。各テストの前提（fixture）は
// frontend/e2e/fixtures/README.md の表を参照。
const CHANGE = '@add-client-side-post-encryption'
const tp = (id: string) => ({ tag: [CHANGE, `@TP-${id}`] })

type Mock = Awaited<ReturnType<typeof installEncryptionMock>>['mock']

/** 暗号化チャネル `secret` の、Markdown・コード・Mermaid を含むポストの見出し語。 */
const RICH_MARKER = '秘密の太字'

async function openChannel(page: Page, name: string) {
  await page.getByTestId(`channel-${name}`).click()
  await expect(page.getByTestId('channel-title')).toContainText(`# ${name}`)
}

/** 解錠済みで暗号化チャネル `secret` を開き、復号した本文が出るまで待つ。 */
async function openUnlockedSecret(page: Page) {
  await openChannel(page, 'secret')
  await expect(page.getByTestId('markdown-body').filter({ hasText: RICH_MARKER })).toBeVisible()
}

async function createChannel(page: Page, name: string, options: { encrypted?: boolean } = {}) {
  await page.getByTestId('new-channel-button').click()
  await page.getByTestId('channel-name-input').fill(name)
  if (options.encrypted) await page.getByTestId('channel-encrypted-toggle').check()
  await page.getByTestId('channel-name-input').press('Enter')
}

async function dragOnto(page: Page, sourceTestId: string, targetTestId: string) {
  const from = await page.getByTestId(sourceTestId).boundingBox()
  const to = await page.getByTestId(targetTestId).boundingBox()
  if (!from || !to) throw new Error('drag source or target is not visible')
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
  await page.mouse.down()
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 25 })
  await page.mouse.up()
}

async function send(scope: Page | Locator, text: string) {
  const input = scope.getByTestId('composer-input')
  await input.fill(text)
  await input.press('Shift+Enter')
}

async function openSettings(page: Page) {
  // E2E のビルドはアプリメニューを持つ adapter なので、設定はショートカットで開く。
  // 入力欄にフォーカスがあるとショートカットは効かないので、見出しへ移してから押す。
  await page.getByTestId('channel-title').click()
  await page.keyboard.press('ControlOrMeta+,')
  await expect(page.getByTestId('encryption-settings')).toBeVisible()
}

async function closeSettings(page: Page) {
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('settings-dialog')).toHaveCount(0)
}

async function lockFromSettings(page: Page) {
  await openSettings(page)
  await page.getByTestId('encryption-lock').click()
  await expect(page.getByTestId('encryption-settings-unlock')).toBeVisible()
  await closeSettings(page)
}

function requestsOf(mock: Mock, method: string, path: RegExp) {
  return mock.v1Requests().filter((request) => request.method === method && path.test(request.path))
}

function jsonOf(request: V1Request) {
  return JSON.parse(request.body ?? '{}') as Record<string, unknown>
}

/** 暗号化チャネルへの要求に、平文が無く、この鍵の暗号文だけがある。 */
function expectCiphertextOnly(request: V1Request, keyId: string, plaintext: string) {
  const body = jsonOf(request)
  expect(body.ciphertext).toEqual(expect.stringMatching(new RegExp(`^pe1\\.${keyId}\\.`)))
  expect(body.body ?? '').toBe('')
  expect(body.attachmentIds ?? []).toEqual([])
  expect(request.body).not.toContain(plaintext)
}

/** 非暗号化チャネルへの要求は、従来どおり本文の平文を送り、暗号文は無い。 */
function expectPlainOnly(request: V1Request, plaintext: string) {
  const body = jsonOf(request)
  expect(body.body).toBe(plaintext)
  expect(body.ciphertext ?? null).toBeNull()
}

function postsCreated(mock: Mock) {
  return requestsOf(mock, 'POST', /^\/v1\/channels\/[^/]+\/posts$/)
}

test.describe('暗号化チャネル', () => {
  test('暗号化を選んで作ったチャネルが暗号化チャネルになり、一覧と見出しに印が付く', tp('001'), async ({ page }) => {
    // fixture: mock:encryption-unlocked
    const { mock } = await installEncryptionMock(page, 'unlocked')
    await page.goto('/')
    await openUnlockedSecret(page)

    await createChannel(page, 'vault', { encrypted: true })
    await expect(page.getByTestId('channel-vault')).toBeVisible()

    const [created] = requestsOf(mock, 'POST', /^\/v1\/channels$/)
    expect(jsonOf(created!)).toMatchObject({ name: 'vault', encrypted: true })
    await expect(page.getByTestId('encrypted-channel-vault')).toBeVisible()
    await openChannel(page, 'vault')
    await expect(page.getByTestId('channel-title').getByTestId('encrypted-channel-mark')).toBeVisible()
  })

  test('既定では非暗号化チャネルが作られ、印も暗号化の選択も無く、投稿は平文で送られる', tp('002'), async ({ page }) => {
    // fixture: mock:encryption-unlocked
    const { mock } = await installEncryptionMock(page, 'unlocked')
    await page.goto('/')
    await openUnlockedSecret(page)

    await page.getByTestId('new-channel-button').click()
    await expect(page.getByTestId('channel-encrypted-toggle')).not.toBeChecked()
    await page.getByTestId('channel-name-input').fill('plain')
    await page.getByTestId('channel-name-input').press('Enter')
    await expect(page.getByTestId('channel-plain')).toBeVisible()

    const [created] = requestsOf(mock, 'POST', /^\/v1\/channels$/)
    expect(jsonOf(created!).encrypted ?? false).toBe(false)
    await expect(page.getByTestId('encrypted-channel-plain')).toHaveCount(0)
    await openChannel(page, 'plain')
    await expect(page.getByTestId('encrypted-channel-mark')).toHaveCount(0)
    await expect(page.getByTestId('composer-encrypted')).toHaveCount(0)
    await expect(page.getByTestId('composer-attach')).toBeVisible()

    await send(page, 'TP002 の平文ポスト')
    await expect(page.getByTestId('timeline').getByText('TP002 の平文ポスト')).toBeVisible()
    const [posted] = postsCreated(mock)
    expectPlainOnly(posted!, 'TP002 の平文ポスト')
  })

  test('未設定で暗号化チャネルを作ると初期設定を求められ、鍵束を 1 回だけ登録してから作成する', tp('003'), async ({ page }) => {
    // fixture: mock:encryption-unconfigured
    const { mock } = await installEncryptionMock(page, 'unconfigured')
    await page.goto('/')
    await expect(page.getByTestId('channel-inbox')).toBeVisible()

    await createChannel(page, 'vault', { encrypted: true })
    await expect(page.getByTestId('encryption-setup')).toBeVisible()
    expect(requestsOf(mock, 'POST', /^\/v1\/channels$/)).toEqual([])
    expect(requestsOf(mock, 'POST', /^\/v1\/encryption\/keyring$/)).toEqual([])

    await completeSetup(page)
    await expect(page.getByTestId('encrypted-channel-vault')).toBeVisible()

    const writes = mock.v1Requests().filter((request) => request.method !== 'GET')
    const keyringIndex = writes.findIndex((request) => request.path === '/v1/encryption/keyring')
    const channelIndex = writes.findIndex((request) => request.path === '/v1/channels')
    expect(requestsOf(mock, 'POST', /^\/v1\/encryption\/keyring$/)).toHaveLength(1)
    expect(keyringIndex).toBeGreaterThanOrEqual(0)
    expect(channelIndex).toBeGreaterThan(keyringIndex)
    expect(jsonOf(writes[channelIndex]!)).toMatchObject({ name: 'vault', encrypted: true })

    // 端末は解錠済みなので、解錠を求められずに暗号文で投稿できる。
    await openChannel(page, 'vault')
    await send(page, 'TP003 の初投稿')
    await expect(page.getByTestId('timeline').getByText('TP003 の初投稿')).toBeVisible()
    await expect(page.getByTestId('encryption-dialog')).toHaveCount(0)
    const keyId = mock.storedKeyring()!.keyId
    expectCiphertextOnly(postsCreated(mock).at(-1)!, keyId, 'TP003 の初投稿')
  })

  test('リネームと移動の後も暗号化チャネルのままで、投稿は暗号文で送られる', tp('004'), async ({ page }) => {
    // fixture: mock:encryption-unlocked
    const { mock, workspace } = await installEncryptionMock(page, 'unlocked')
    await page.goto('/')
    await openUnlockedSecret(page)
    await createChannel(page, 'parent')
    await expect(page.getByTestId('channel-parent')).toBeVisible()

    await page.getByTestId('channel-secret').dblclick()
    await page.getByTestId('channel-name-input').fill('vault')
    await page.getByTestId('channel-tree').click({ position: { x: 5, y: 5 } })
    await expect(page.getByTestId('encrypted-channel-vault')).toBeVisible()
    // 名前の変更では、暗号化を変える操作を出さない。
    await expect(page.getByTestId('channel-encrypted-toggle')).toHaveCount(0)

    await dragOnto(page, 'channel-drag-vault', 'channel-row-parent')
    await expect(page.getByTestId('channel-row-vault')).toHaveAttribute('data-depth', '1')
    await expect(page.getByTestId('encrypted-channel-vault')).toBeVisible()

    for (const request of [
      ...requestsOf(mock, 'PATCH', /^\/v1\/channels\/[^/]+$/),
      ...requestsOf(mock, 'POST', /^\/v1\/channels\/[^/]+\/move$/),
    ]) {
      expect(jsonOf(request)).not.toHaveProperty('encrypted')
    }
    expect(requestsOf(mock, 'POST', /^\/v1\/channels\/[^/]+\/move$/)).toHaveLength(1)

    await openChannel(page, 'vault')
    await expect(page.getByTestId('channel-title').getByTestId('encrypted-channel-mark')).toBeVisible()
    await send(page, 'TP004 移動後の投稿')
    await expect(page.getByTestId('timeline').getByText('TP004 移動後の投稿')).toBeVisible()
    expectCiphertextOnly(postsCreated(mock).at(-1)!, workspace.keyId, 'TP004 移動後の投稿')
  })

  test('暗号化チャネルの子を、非暗号化チャネルとして作れる', tp('005'), async ({ page }) => {
    // fixture: mock:encryption-unlocked
    const { mock } = await installEncryptionMock(page, 'unlocked')
    await page.goto('/')
    await openUnlockedSecret(page)

    await createChannel(page, 'child')
    await expect(page.getByTestId('channel-child')).toBeVisible()
    await dragOnto(page, 'channel-drag-child', 'channel-row-secret')
    await expect(page.getByTestId('channel-row-child')).toHaveAttribute('data-depth', '1')

    expect(jsonOf(requestsOf(mock, 'POST', /^\/v1\/channels$/)[0]!).encrypted ?? false).toBe(false)
    await expect(page.getByTestId('encrypted-channel-child')).toHaveCount(0)
    await expect(page.getByTestId('encrypted-channel-secret')).toBeVisible()

    await openChannel(page, 'child')
    await expect(page.getByTestId('composer-encrypted')).toHaveCount(0)
    await send(page, 'TP005 子チャネルの平文')
    await expect(page.getByTestId('timeline').getByText('TP005 子チャネルの平文')).toBeVisible()
    expectPlainOnly(postsCreated(mock).at(-1)!, 'TP005 子チャネルの平文')
  })

  test('暗号化チャネルへの投稿は暗号文だけを送り、応答を待たずに平文で表示する', tp('006'), async ({ page }) => {
    // fixture: mock:encryption-unlocked
    const { mock, workspace } = await installEncryptionMock(page, 'unlocked')
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    await page.route('**/v1/channels/*/posts', async (route) => {
      if (route.request().method() === 'POST') await gate
      await route.fallback()
    })
    await page.goto('/')
    await openUnlockedSecret(page)
    await expect(page.getByTestId('composer-encrypted')).toContainText('暗号化して送信')

    const response = page.waitForResponse(
      (candidate) => candidate.request().method() === 'POST' && /\/v1\/channels\/[^/]+\/posts$/.test(candidate.url()),
    )
    try {
      await send(page, 'TP006 暗号化する本文')
      // サーバーの応答を待たずに、送信した端末の平文で表示する。
      await expect(page.getByTestId('timeline').getByText('TP006 暗号化する本文')).toBeVisible()
      await expect(page.getByTestId('composer-input')).toHaveValue('')
    } finally {
      release()
    }
    const request = (await response).request()
    const sent: V1Request = { method: 'POST', path: '', authorization: null, headers: await request.allHeaders(), body: request.postData() }
    expectCiphertextOnly(sent, workspace.keyId, 'TP006 暗号化する本文')
    expectCiphertextOnly(postsCreated(mock).at(-1)!, workspace.keyId, 'TP006 暗号化する本文')
    await expect(page.getByTestId('timeline').getByText('TP006 暗号化する本文')).toBeVisible()
  })

  test('暗号化チャネルのスレッドへの返信は暗号文で送られる', tp('007'), async ({ page }) => {
    // fixture: mock:encryption-unlocked
    const { mock, workspace, secret } = await installEncryptionMock(page, 'unlocked')
    await page.goto('/')
    await openUnlockedSecret(page)

    const root = page.getByTestId(`post-${secret!.posts[1]!.id}`)
    await expect(root).toContainText(SECRET_THREAD_ROOT)
    await root.getByRole('button', { name: /1 件の返信/ }).click()
    const panel = page.getByTestId('thread-panel')
    await expect(panel.getByText(SECRET_THREAD_REPLY)).toBeVisible()
    await expect(panel.getByTestId('composer-encrypted')).toBeVisible()

    await send(panel.getByTestId('thread-composer'), 'TP007 スレッドへの返信')
    await expect(panel.getByText('TP007 スレッドへの返信')).toBeVisible()
    const [reply] = requestsOf(mock, 'POST', /^\/v1\/posts\/[^/]+\/replies$/)
    expectCiphertextOnly(reply!, workspace.keyId, 'TP007 スレッドへの返信')
  })

  test('ロック中は解錠するまで送信せず、入力を保持し、解錠後に暗号文で送る', tp('008'), async ({ page }) => {
    // fixture: mock:encryption-locked
    const { mock, workspace } = await installEncryptionMock(page, 'locked')
    await page.goto('/')
    await openChannel(page, 'secret')
    await expect(page.getByTestId('locked-post').first()).toBeVisible()

    await send(page, 'TP008 ロック中に書いた本文')
    await expect(page.getByTestId('encryption-unlock')).toBeVisible()
    expect(postsCreated(mock)).toEqual([])
    await expect(page.getByTestId('composer-input')).toHaveValue('TP008 ロック中に書いた本文')

    await unlockWith(page, TEST_PASSPHRASE)
    await expect(page.getByTestId('encryption-dialog')).toHaveCount(0)
    await expect(page.getByTestId('timeline').getByText('TP008 ロック中に書いた本文')).toBeVisible()
    await expect.poll(() => postsCreated(mock).length).toBe(1)
    expectCiphertextOnly(postsCreated(mock)[0]!, workspace.keyId, 'TP008 ロック中に書いた本文')
  })

  test('初期設定から編集・ロック・解錠まで、全要求に平文・パスフレーズ・復旧キーが現れない', tp('009'), async ({ page }) => {
    // fixture: mock:encryption-unconfigured
    const { mock } = await installEncryptionMock(page, 'unconfigured')
    await page.goto('/')
    await expect(page.getByTestId('channel-inbox')).toBeVisible()

    await createChannel(page, 'vault', { encrypted: true })
    const recoveryKey = await completeSetup(page, NEW_PASSPHRASE)
    expect(recoveryKey).toMatch(/^[0-9A-Z]{4}(-[0-9A-Z]{4})+$/)
    await openChannel(page, 'vault')
    await send(page, 'TP009 最初の秘密')
    const post = page.getByTestId('timeline').locator('article').filter({ hasText: 'TP009 最初の秘密' })
    await expect(post).toBeVisible()
    await expect.poll(() => postsCreated(mock).length).toBe(1)

    await page.reload()
    await openChannel(page, 'vault')
    await expect(page.getByTestId('locked-post')).toBeVisible()
    await page.getByTestId('unlock-post').click()
    await unlockWith(page, NEW_PASSPHRASE)
    const reloaded = page.getByTestId('timeline').locator('article').filter({ hasText: 'TP009 最初の秘密' })
    await reloaded.hover()
    await reloaded.getByRole('button', { name: /ポストを編集/ }).click()
    const editor = page.getByTestId('timeline').locator('[data-testid^="post-editor-"]')
    await expect(editor.getByTestId('composer-input')).toHaveValue('TP009 最初の秘密')
    await editor.getByTestId('composer-input').fill('TP009 編集した秘密')
    await editor.getByRole('button', { name: '保存' }).click()
    await expect(page.getByTestId('timeline').getByText('TP009 編集した秘密')).toBeVisible()
    await expect.poll(() => requestsOf(mock, 'PATCH', /^\/v1\/posts\/[^/]+$/).length).toBe(1)

    await lockFromSettings(page)
    await expect(page.getByTestId('locked-post')).toBeVisible()
    await page.getByTestId('unlock-post').click()
    await unlockWith(page, NEW_PASSPHRASE)
    await expect(page.getByTestId('timeline').getByText('TP009 編集した秘密')).toBeVisible()

    const forbidden = [
      'TP009 最初の秘密',
      'TP009 編集した秘密',
      NEW_PASSPHRASE,
      recoveryKey,
      recoveryKey.replace(/-/g, ''),
    ]
    const requests = mock.v1Requests()
    expect(requests.length).toBeGreaterThan(0)
    for (const request of requests) {
      const wire = [request.path, JSON.stringify(request.headers), request.body ?? ''].join('\n')
      for (const secret of forbidden) expect(wire, `${request.method} ${request.path}`).not.toContain(secret)
    }
  })

  test('短いパスフレーズや保管の未確認では初期設定が完了せず、登録も作成も要求しない', tp('010'), async ({ page }) => {
    // fixture: mock:encryption-unconfigured
    const { mock } = await installEncryptionMock(page, 'unconfigured')
    await page.goto('/')
    await expect(page.getByTestId('channel-inbox')).toBeVisible()
    await createChannel(page, 'vault', { encrypted: true })

    const setup = page.getByTestId('encryption-setup')
    await setup.getByTestId('setup-passphrase').fill('short-pass')
    await setup.getByTestId('setup-passphrase-confirm').fill('short-pass')
    await expect(setup.getByRole('alert')).toContainText('12 文字以上')
    await expect(setup.getByTestId('setup-continue')).toBeDisabled()

    await setup.getByTestId('setup-passphrase').fill(NEW_PASSPHRASE)
    await setup.getByTestId('setup-passphrase-confirm').fill(NEW_PASSPHRASE)
    await setup.getByTestId('setup-continue').click()
    const recovery = page.getByTestId('encryption-setup-recovery')
    await expect(recovery.getByTestId('setup-recovery-key')).toBeVisible()
    await expect(recovery.getByTestId('setup-recovery-ack')).not.toBeChecked()
    await expect(recovery.getByTestId('setup-finish')).toBeDisabled()
    // Enter で確定しようとしても、保管を確認するまでは完了しない。
    await recovery.getByTestId('setup-recovery-ack').focus()
    await page.keyboard.press('Enter')
    await expect(recovery).toBeVisible()

    expect(requestsOf(mock, 'POST', /^\/v1\/encryption\/keyring$/)).toEqual([])
    expect(requestsOf(mock, 'POST', /^\/v1\/channels$/)).toEqual([])
    await recovery.getByRole('button', { name: 'キャンセル' }).click()
    await expect(page.getByTestId('encryption-dialog')).toHaveCount(0)
    expect(requestsOf(mock, 'POST', /^\/v1\/encryption\/keyring$/)).toEqual([])
    expect(requestsOf(mock, 'POST', /^\/v1\/channels$/)).toEqual([])
    await expect(page.getByTestId('channel-vault')).toHaveCount(0)
  })

  test('初期設定の確定で 409 が返ると、既存の鍵を置き換えずに解錠へ切り替える', tp('011'), async ({ page }) => {
    // fixture: mock:encryption-setup-conflict
    const { mock, workspace } = await installEncryptionMock(page, 'setup-conflict')
    await page.goto('/')
    await expect(page.getByTestId('channel-inbox')).toBeVisible()
    await createChannel(page, 'vault', { encrypted: true })

    const setup = page.getByTestId('encryption-setup')
    await setup.getByTestId('setup-passphrase').fill(NEW_PASSPHRASE)
    await setup.getByTestId('setup-passphrase-confirm').fill(NEW_PASSPHRASE)
    await setup.getByTestId('setup-continue').click()
    const recovery = page.getByTestId('encryption-setup-recovery')
    await recovery.getByTestId('setup-recovery-ack').check()
    await recovery.getByTestId('setup-finish').click()

    await expect(page.getByTestId('setup-conflict')).toBeVisible()
    await expect(page.getByTestId('encryption-unlock')).toBeVisible()
    expect(mock.storedKeyring()).toEqual(workspace.keyring)
    expect(requestsOf(mock, 'POST', /^\/v1\/channels$/)).toEqual([])

    // 別の端末が設定したパスフレーズで解錠する。自分が入れたパスフレーズの鍵束は残らない。
    await unlockWith(page, TEST_PASSPHRASE)
    await expect(page.getByTestId('encryption-dialog')).toHaveCount(0)
    expect(mock.storedKeyring()).toEqual(workspace.keyring)
    expect(requestsOf(mock, 'PUT', /^\/v1\/encryption\/keyring\//)).toEqual([])

    await createChannel(page, 'vault', { encrypted: true })
    await expect(page.getByTestId('encrypted-channel-vault')).toBeVisible()
    await expect(page.getByTestId('encryption-dialog')).toHaveCount(0)
  })

  test('別の端末の Markdown・コード・Mermaid のポストが、ロック中の表示の導線から解錠すると再読み込みなしで描画される', tp('012'), async ({ page }) => {
    // fixture: mock:encryption-locked
    const { secret } = await installEncryptionMock(page, 'locked')
    await page.goto('/')
    await openChannel(page, 'secret')
    const rich = page.getByTestId(`post-${secret!.posts[0]!.id}`)
    await expect(rich.getByTestId('locked-post')).toBeVisible()
    await page.evaluate(() => {
      ;(window as Window & { __sameDocument?: boolean }).__sameDocument = true
    })

    await rich.getByTestId('unlock-post').click()
    await unlockWith(page, TEST_PASSPHRASE)

    await expect(rich.getByTestId('markdown-body').locator('strong')).toHaveText(RICH_MARKER)
    await expect(rich.getByTestId('code-block').locator('pre.shiki')).toBeVisible()
    await expect(rich.getByTestId('code-block')).toContainText('secretAnswer')
    await expect(rich.getByTestId('mermaid-block').locator('svg')).toBeVisible()
    await expect(rich.getByTestId('mermaid-block').getByText('秘密の開始')).toBeVisible()
    expect(await page.evaluate(() => (window as Window & { __sameDocument?: boolean }).__sameDocument)).toBe(true)
  })

  test('誤ったパスフレーズでは解錠されず、本文は出ない', tp('013'), async ({ page }) => {
    // fixture: mock:encryption-locked
    await installEncryptionMock(page, 'locked')
    await page.goto('/')
    await openChannel(page, 'secret')
    await page.getByTestId('unlock-post').first().click()

    await unlockWith(page, WRONG_PASSPHRASE)
    await expect(page.getByTestId('unlock-error')).toContainText('解錠できませんでした')
    await page.getByRole('button', { name: 'キャンセル' }).click()
    await expect(page.getByTestId('locked-post')).toHaveCount(2)
    await expect(page.getByText(RICH_MARKER)).toHaveCount(0)
    await expect(page.getByText(SECRET_THREAD_ROOT)).toHaveCount(0)
  })

  test('復旧キーで解錠でき、新しいパスフレーズの設定へ促される', tp('014'), async ({ page }) => {
    // fixture: mock:encryption-locked
    const { mock, workspace } = await installEncryptionMock(page, 'locked')
    await page.goto('/')
    await openChannel(page, 'secret')
    await page.getByTestId('unlock-post').first().click()

    await unlockWith(page, TEST_RECOVERY_KEY.toLowerCase().replace(/-/g, ' '), { recovery: true })
    const prompt = page.getByTestId('new-passphrase-prompt')
    await expect(prompt).toBeVisible()
    await expect(page.getByTestId('markdown-body').filter({ hasText: RICH_MARKER })).toBeVisible()

    await prompt.getByTestId('new-passphrase').fill(NEW_PASSPHRASE)
    await prompt.getByTestId('new-passphrase-confirm').fill(NEW_PASSPHRASE)
    await prompt.getByRole('button', { name: '設定する' }).click()
    await expect(page.getByTestId('encryption-dialog')).toHaveCount(0)

    const [replaced] = requestsOf(mock, 'PUT', /^\/v1\/encryption\/keyring\/passphrase$/)
    expect(replaced!.headers['x-postall-key-proof']).toBe(workspace.keyring.keyProof)
    expect(replaced!.body).not.toContain(NEW_PASSPHRASE)
    expect(mock.storedKeyring()!.passphraseWrap).not.toEqual(workspace.keyring.passphraseWrap)
  })

  test('記憶しないで解錠した後に開き直すと、ロック中になる', tp('015'), async ({ page }) => {
    // fixture: mock:encryption-locked
    await installEncryptionMock(page, 'locked')
    await page.goto('/')
    await openChannel(page, 'secret')
    await page.getByTestId('unlock-post').first().click()
    await expect(page.getByTestId('unlock-remember')).not.toBeChecked()
    await unlockWith(page, TEST_PASSPHRASE)
    await expect(page.getByTestId('markdown-body').filter({ hasText: RICH_MARKER })).toBeVisible()
    expect(await readRememberedKey(page)).toBeNull()

    await page.reload()
    await expect(page.getByTestId('channel-title')).toContainText('# secret')
    await expect(page.getByTestId('locked-post')).toHaveCount(2)
    await expect(page.getByText(RICH_MARKER)).toHaveCount(0)
  })

  test('記憶して解錠した後に開き直すと、パスフレーズなしで表示される', tp('016'), async ({ page }) => {
    // fixture: mock:encryption-locked
    await installEncryptionMock(page, 'locked')
    await page.goto('/')
    await openChannel(page, 'secret')
    await page.getByTestId('unlock-post').first().click()
    await unlockWith(page, TEST_PASSPHRASE, { remember: true })
    await expect(page.getByTestId('markdown-body').filter({ hasText: RICH_MARKER })).toBeVisible()

    await page.reload()
    await expect(page.getByTestId('markdown-body').filter({ hasText: RICH_MARKER })).toBeVisible()
    await expect(page.getByTestId('locked-post')).toHaveCount(0)
    await expect(page.getByTestId('encryption-dialog')).toHaveCount(0)
  })

  test('記憶した鍵の値は取り出せず、秘密の値は端末のストレージに平文で無い', tp('017'), async ({ page }) => {
    // fixture: mock:encryption-locked
    const { workspace } = await installEncryptionMock(page, 'locked')
    await page.goto('/')
    await openChannel(page, 'secret')
    await page.getByTestId('unlock-post').first().click()
    await unlockWith(page, TEST_PASSPHRASE, { remember: true })
    await expect(page.getByTestId('markdown-body').filter({ hasText: RICH_MARKER })).toBeVisible()

    const remembered = await readRememberedKey(page)
    expect(remembered).toMatchObject({ keyId: workspace.keyId, type: 'secret', extractable: false })
    expect(remembered!.exported).not.toBe('exported')

    const storage = await dumpDeviceStorage(page)
    expect(storage).toContain('[CryptoKey secret]')
    for (const secret of [
      TEST_PASSPHRASE,
      TEST_RECOVERY_KEY,
      TEST_RECOVERY_KEY.replace(/-/g, ''),
      workspace.masterKey,
      RICH_MARKER,
      SECRET_THREAD_ROOT,
    ]) {
      expect(storage).not.toContain(secret)
    }
  })

  test('記憶しないで解錠すると、15 分操作が無いとロックされ、15 分未満ではロックされない', tp('018'), async ({ page }) => {
    // fixture: mock:encryption-unlocked + clock:idle（記憶しない解錠が要るので、鍵は置かずに開いて解錠する）
    await installEncryptionMock(page, 'locked')
    await installIdleClock(page)
    await page.goto('/')
    await openChannel(page, 'secret')
    await page.getByTestId('unlock-post').first().click()
    await unlockWith(page, TEST_PASSPHRASE)
    const body = page.getByTestId('markdown-body').filter({ hasText: RICH_MARKER })
    await expect(body).toBeVisible()

    await idle(page, '14:00')
    await expect(body).toBeVisible()
    await expect(page.getByTestId('locked-post')).toHaveCount(0)

    await idle(page, '01:05')
    await expect(page.getByTestId('locked-post')).toHaveCount(2)
    await expect(page.getByText(RICH_MARKER)).toHaveCount(0)
  })

  test('手動でロックすると直ちにロック中になり、開き直しても解錠を求められる', tp('019'), async ({ page }) => {
    // fixture: mock:encryption-locked
    await installEncryptionMock(page, 'locked')
    await page.goto('/')
    await openChannel(page, 'secret')
    await page.getByTestId('unlock-post').first().click()
    await unlockWith(page, TEST_PASSPHRASE, { remember: true })
    await expect(page.getByTestId('markdown-body').filter({ hasText: RICH_MARKER })).toBeVisible()

    await lockFromSettings(page)
    await expect(page.getByTestId('locked-post')).toHaveCount(2)
    await expect(page.getByText(RICH_MARKER)).toHaveCount(0)
    expect(await readRememberedKey(page)).toBeNull()

    await page.reload()
    await expect(page.getByTestId('channel-title')).toContainText('# secret')
    await expect(page.getByTestId('locked-post')).toHaveCount(2)
    await expect(page.getByText(RICH_MARKER)).toHaveCount(0)
  })

  test('編集中に自動ロックされると、編集フォームが閉じて平文が残らない', tp('020'), async ({ page }) => {
    // fixture: mock:encryption-unlocked + clock:idle（記憶しない解錠が要るので、鍵は置かずに開いて解錠する）
    const { secret } = await installEncryptionMock(page, 'locked')
    await installIdleClock(page)
    await page.goto('/')
    await openChannel(page, 'secret')
    await page.getByTestId('unlock-post').first().click()
    await unlockWith(page, TEST_PASSPHRASE)
    const root = page.getByTestId(`post-${secret!.posts[1]!.id}`)
    await expect(root).toContainText(SECRET_THREAD_ROOT)

    await root.hover()
    await root.getByRole('button', { name: /ポストを編集/ }).click()
    const editor = page.getByTestId(`post-editor-${secret!.posts[1]!.id}`)
    await expect(editor.getByTestId('composer-input')).toHaveValue(SECRET_THREAD_ROOT)
    await editor.getByTestId('composer-input').fill('TP020 保存していない平文')

    await idle(page, '15:05')
    await expect(editor).toHaveCount(0)
    await expect(root.getByTestId('locked-post')).toBeVisible()
    await expect(page.getByText('TP020 保存していない平文')).toHaveCount(0)
    expect(await dumpDeviceStorage(page)).not.toContain('TP020 保存していない平文')
  })

  test('サインアウト後に再びサインインすると、ロック中で、鍵が端末に無い', tp('021'), async ({ page }) => {
    // fixture: mock:encryption-locked
    await installEncryptionMock(page, 'locked')
    await page.goto('/')
    await openChannel(page, 'secret')
    await page.getByTestId('unlock-post').first().click()
    await unlockWith(page, TEST_PASSPHRASE, { remember: true })
    await expect(page.getByTestId('markdown-body').filter({ hasText: RICH_MARKER })).toBeVisible()
    expect(await readRememberedKey(page)).not.toBeNull()

    await openSettings(page)
    await page.getByTestId('sign-out-button').click()
    await expect(page.getByTestId('sign-in-button')).toBeVisible()
    expect(await readRememberedKey(page)).toBeNull()

    // E2E のビルドでは、開き直すとテスト用のトークンでサインインし直す。
    await page.reload()
    await openChannel(page, 'secret')
    await expect(page.getByTestId('locked-post')).toHaveCount(2)
    await expect(page.getByText(RICH_MARKER)).toHaveCount(0)
    expect(await readRememberedKey(page)).toBeNull()
  })

  test('ロック中の暗号化チャネルでは本文が出ず、解錠の導線があり、編集と返信の導線が無い', tp('022'), async ({ page }) => {
    // fixture: mock:encryption-locked
    const { secret } = await installEncryptionMock(page, 'locked')
    await page.goto('/')
    await openChannel(page, 'secret')

    const timeline = page.getByTestId('timeline')
    await expect(timeline.getByTestId('locked-post')).toHaveCount(2)
    await expect(timeline.getByTestId('unlock-post')).toHaveCount(2)
    for (const text of [RICH_MARKER, SECRET_THREAD_ROOT, SECRET_THREAD_REPLY, 'pe1.']) {
      await expect(page.getByText(text)).toHaveCount(0)
    }
    const root = page.getByTestId(`post-${secret!.posts[1]!.id}`)
    await root.hover()
    await expect(timeline.getByTestId('post-actions')).toHaveCount(0)
    await expect(timeline.getByRole('button', { name: /編集/ })).toHaveCount(0)
    await expect(timeline.getByRole('button', { name: /スレッドで返信|件の返信/ })).toHaveCount(0)
    // 返信件数は平文のメタデータなので表示してよい。
    await expect(root).toContainText('1 件の返信')
    await expect(page.getByTestId('thread-panel')).toHaveCount(0)
    await expect(page.getByTestId('composer-encrypted')).toBeVisible()
    await expect(page.getByTestId('composer-attach')).toHaveCount(0)
  })

  test('ロック中でも、非暗号化チャネルは解錠なしで表示・投稿できる', tp('023'), async ({ page }) => {
    // fixture: mock:encryption-locked
    const { mock } = await installEncryptionMock(page, 'locked')
    await page.goto('/')
    await openChannel(page, 'inbox')
    await expect(page.getByTestId('timeline').getByText(INBOX_BODY)).toBeVisible()
    await expect(page.getByTestId('composer-encrypted')).toHaveCount(0)

    await send(page, 'TP023 ロック中の平文')
    await expect(page.getByTestId('timeline').getByText('TP023 ロック中の平文')).toBeVisible()
    await expect(page.getByTestId('encryption-dialog')).toHaveCount(0)
    await expect.poll(() => postsCreated(mock).length).toBe(1)
    expectPlainOnly(postsCreated(mock)[0]!, 'TP023 ロック中の平文')
  })

  test('改ざんした暗号文と別の鍵の暗号文は復号できないと示し、他のポストは正しく表示する', tp('024'), async ({ page }) => {
    // fixture: mock:encryption-tampered-post
    const { secret } = await installEncryptionMock(page, 'tampered-post')
    await page.goto('/')
    await openChannel(page, 'secret')
    await page.getByTestId('unlock-post').first().click()
    await unlockWith(page, TEST_PASSPHRASE)

    const [intact, tampered, foreign] = secret!.posts.map((post) => page.getByTestId(`post-${post.id}`))
    await expect(intact!.getByTestId('markdown-body')).toHaveText(SECRET_INTACT_BODY)
    await expect(tampered!.getByTestId('undecryptable-post')).toBeVisible()
    await expect(foreign!.getByTestId('undecryptable-post')).toBeVisible()
    for (const text of [TAMPERED_PLAINTEXT, FOREIGN_PLAINTEXT, 'pe1.']) {
      await expect(page.getByText(text)).toHaveCount(0)
    }
  })

  test('暗号化チャネルのポストを編集すると、新しい暗号文だけを送る', tp('025'), async ({ page }) => {
    // fixture: mock:encryption-unlocked
    const { mock, workspace, secret } = await installEncryptionMock(page, 'unlocked')
    await page.goto('/')
    await openUnlockedSecret(page)
    const target = secret!.posts[1]!
    const before = mock.storedPosts().find((post) => post.id === target.id)!.ciphertext

    const root = page.getByTestId(`post-${target.id}`)
    await root.hover()
    await root.getByRole('button', { name: /ポストを編集/ }).click()
    const editor = page.getByTestId(`post-editor-${target.id}`)
    await expect(editor.getByTestId('composer-input')).toHaveValue(SECRET_THREAD_ROOT)
    await expect(editor.getByTestId('composer-attach')).toHaveCount(0)
    await editor.getByTestId('composer-input').fill('TP025 編集後の秘密')
    await editor.getByRole('button', { name: '保存' }).click()

    await expect(root).toContainText('TP025 編集後の秘密')
    await expect.poll(() => requestsOf(mock, 'PATCH', /^\/v1\/posts\/[^/]+$/).length).toBe(1)
    const [edit] = requestsOf(mock, 'PATCH', /^\/v1\/posts\/[^/]+$/)
    expect(edit!.path).toBe(`/v1/posts/${target.id}`)
    expectCiphertextOnly(edit!, workspace.keyId, 'TP025 編集後の秘密')
    expect(edit!.body).not.toContain(SECRET_THREAD_ROOT)
    const after = mock.storedPosts().find((post) => post.id === target.id)!
    expect(after.body).toBe('')
    expect(after.ciphertext).not.toBe(before)
  })

  test('パスフレーズの変更後は古いパスフレーズで解錠できず、新しいもので解錠でき、既存のポストが読める', tp('026'), async ({ page }) => {
    // fixture: mock:encryption-unlocked
    const { mock, workspace } = await installEncryptionMock(page, 'unlocked')
    await page.goto('/')
    await openUnlockedSecret(page)

    await openSettings(page)
    await page.getByTestId('encryption-change-passphrase').click()
    const form = page.getByTestId('change-passphrase-form')
    await form.getByTestId('current-secret').fill(TEST_PASSPHRASE)
    await form.getByTestId('next-passphrase').fill(NEW_PASSPHRASE)
    await form.getByTestId('next-passphrase-confirm').fill(NEW_PASSPHRASE)
    await form.getByTestId('change-passphrase-submit').click()
    await expect(form).toHaveCount(0)
    const [replaced] = requestsOf(mock, 'PUT', /^\/v1\/encryption\/keyring\/passphrase$/)
    expect(replaced!.headers['x-postall-key-proof']).toBe(workspace.keyring.keyProof)
    await page.getByTestId('encryption-lock').click()
    await expect(page.getByTestId('encryption-settings-unlock')).toBeVisible()
    await closeSettings(page)

    await expect(page.getByTestId('locked-post')).toHaveCount(2)
    await page.getByTestId('unlock-post').first().click()
    await unlockWith(page, TEST_PASSPHRASE)
    await expect(page.getByTestId('unlock-error')).toBeVisible()
    await page.getByTestId('unlock-secret').fill(NEW_PASSPHRASE)
    await page.getByTestId('unlock-submit').click()
    await expect(page.getByTestId('encryption-dialog')).toHaveCount(0)
    await expect(page.getByTestId('markdown-body').filter({ hasText: RICH_MARKER })).toBeVisible()
    await expect(page.getByText(SECRET_THREAD_ROOT)).toBeVisible()
  })

  test('復旧キーの再発行後は古い復旧キーで解錠できず、新しい復旧キーで解錠できる', tp('027'), async ({ page }) => {
    // fixture: mock:encryption-unlocked
    const { mock, workspace } = await installEncryptionMock(page, 'unlocked')
    await page.goto('/')
    await openUnlockedSecret(page)

    await openSettings(page)
    await page.getByTestId('encryption-rotate-recovery').click()
    const form = page.getByTestId('rotate-recovery-form')
    await form.getByTestId('current-secret').fill(TEST_PASSPHRASE)
    await form.getByTestId('rotate-recovery-submit').click()
    const rotated = (await form.getByTestId('rotated-recovery-key').textContent()) ?? ''
    expect(rotated).not.toBe(TEST_RECOVERY_KEY)
    // 保管を確認するまでは確定しない。
    await expect(form.getByTestId('rotate-recovery-submit')).toBeDisabled()
    expect(requestsOf(mock, 'PUT', /^\/v1\/encryption\/keyring\/recovery$/)).toEqual([])
    await form.getByTestId('rotated-recovery-ack').check()
    await form.getByTestId('rotate-recovery-submit').click()
    await expect(form).toHaveCount(0)
    const [replaced] = requestsOf(mock, 'PUT', /^\/v1\/encryption\/keyring\/recovery$/)
    expect(replaced!.headers['x-postall-key-proof']).toBe(workspace.keyring.keyProof)
    expect(replaced!.body).not.toContain(rotated.replace(/-/g, ''))
    await page.getByTestId('encryption-lock').click()
    await closeSettings(page)

    await page.getByTestId('unlock-post').first().click()
    await unlockWith(page, TEST_RECOVERY_KEY, { recovery: true })
    await expect(page.getByTestId('unlock-error')).toBeVisible()
    await page.getByTestId('unlock-secret').fill(rotated)
    await page.getByTestId('unlock-submit').click()
    await expect(page.getByTestId('new-passphrase-prompt')).toBeVisible()
    await page.getByRole('button', { name: 'あとで' }).click()
    await expect(page.getByTestId('encryption-dialog')).toHaveCount(0)
    await expect(page.getByTestId('markdown-body').filter({ hasText: RICH_MARKER })).toBeVisible()
  })

  test('暗号化チャネルとそのスレッドには添付の操作が無く、非暗号化チャネルには残る', tp('028'), async ({ page }) => {
    // fixture: mock:encryption-unlocked
    const { secret } = await installEncryptionMock(page, 'unlocked')
    await page.goto('/')
    await openUnlockedSecret(page)

    await expect(page.getByTestId('composer-attach')).toHaveCount(0)
    await expect(page.getByTestId('composer-encrypted')).toContainText('添付は使えません')
    await page.getByTestId(`post-${secret!.posts[1]!.id}`).getByRole('button', { name: /1 件の返信/ }).click()
    const thread = page.getByTestId('thread-composer')
    await expect(thread.getByTestId('composer-encrypted')).toContainText('添付は使えません')
    await expect(thread.getByTestId('composer-attach')).toHaveCount(0)

    await openChannel(page, 'inbox')
    await expect(page.getByTestId('timeline').getByText(INBOX_BODY)).toBeVisible()
    await expect(page.getByTestId('composer-attach').first()).toBeVisible()
    await expect(page.getByTestId('composer-encrypted')).toHaveCount(0)
  })

  test('暗号化チャネルの下書きは、開き直すと復元されず、端末のストレージにも残らない', tp('029'), async ({ page }) => {
    // fixture: mock:encryption-unlocked
    await installEncryptionMock(page, 'unlocked')
    await page.goto('/')
    await openUnlockedSecret(page)
    await page.getByTestId('composer-input').fill('TP029 送らない秘密の下書き')
    // 非暗号化チャネルの下書きは従来どおり端末に残る（比較のため）。
    await openChannel(page, 'inbox')
    await page.getByTestId('composer-input').fill('TP029 平文チャネルの下書き')
    await expect.poll(() => dumpDeviceStorage(page)).toContain('TP029 平文チャネルの下書き')
    expect(await dumpDeviceStorage(page)).not.toContain('TP029 送らない秘密の下書き')

    await page.reload()
    await openUnlockedSecret(page)
    await expect(page.getByTestId('composer-input')).toHaveValue('')
    expect(await dumpDeviceStorage(page)).not.toContain('TP029 送らない秘密の下書き')
  })

  test('暗号化チャネルの下書きは、開き直さないチャネルの切り替えでは復元される', tp('030'), async ({ page }) => {
    // fixture: mock:encryption-unlocked
    await installEncryptionMock(page, 'unlocked')
    await page.goto('/')
    await openUnlockedSecret(page)
    await page.getByTestId('composer-input').fill('TP030 切り替えで保つ下書き')

    await openChannel(page, 'inbox')
    await expect(page.getByTestId('composer-input')).not.toHaveValue('TP030 切り替えで保つ下書き')
    await openChannel(page, 'secret')
    await expect(page.getByTestId('composer-input')).toHaveValue('TP030 切り替えで保つ下書き')
  })

  test('暗号化チャネルの未送信の本文は、ロックで入力欄から消える', tp('031'), async ({ page }) => {
    // fixture: mock:encryption-unlocked
    await installEncryptionMock(page, 'unlocked')
    await page.goto('/')
    await openUnlockedSecret(page)
    await page.getByTestId('composer-input').fill('TP031 ロックで消える本文')

    await lockFromSettings(page)
    await expect(page.getByTestId('locked-post')).toHaveCount(2)
    await expect(page.getByTestId('composer-input')).toHaveValue('')
    await openChannel(page, 'inbox')
    await openChannel(page, 'secret')
    await expect(page.getByTestId('composer-input')).toHaveValue('')
    expect(await dumpDeviceStorage(page)).not.toContain('TP031 ロックで消える本文')
  })

  test('iPhone 相当の WebKit で、記憶して解錠して表示でき、開き直してもパスフレーズを求められない', tp('032'), async ({ page }) => {
    // fixture: mock:encryption-locked + browser:webkit-iphone
    await installEncryptionMock(page, 'locked')
    await page.goto('/')
    await page.getByTestId('channel-secret').click()
    await expect(page.getByTestId('timeline')).toBeVisible()
    await page.getByTestId('unlock-post').first().click()
    await unlockWith(page, TEST_PASSPHRASE, { remember: true })
    await expect(page.getByTestId('markdown-body').filter({ hasText: RICH_MARKER })).toBeVisible()
    await expect(page.getByTestId('mermaid-block').locator('svg')).toBeVisible()

    await page.reload()
    await expect(page.getByTestId('channel-title')).toContainText('# secret')
    await expect(page.getByTestId('markdown-body').filter({ hasText: RICH_MARKER })).toBeVisible()
    await expect(page.getByTestId('locked-post')).toHaveCount(0)
    await expect(page.getByTestId('encryption-dialog')).toHaveCount(0)
  })
})
