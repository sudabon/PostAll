import { installApiMock, expect, test } from './mock'
import { devices, type Page } from '@playwright/test'

async function dragByMouse(page: Page, sourceTestId: string, targetTestId: string) {
  const source = page.getByTestId(sourceTestId)
  const target = page.getByTestId(targetTestId)
  const from = await source.boundingBox()
  const to = await target.boundingBox()
  if (!from || !to) throw new Error('drag source or target is not visible')
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
  await page.mouse.down()
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 25 })
  await page.mouse.up()
}

test('sign-in workspace post thread dnd and restore', async ({ page }) => {
  await installApiMock(page)
  await page.goto('/')
  await expect(page.getByTestId('channel-tree')).toBeVisible()
  await expect(page.getByTestId('sign-in-button')).toHaveCount(0)

  await page.getByTestId('new-channel-button').click()
  await page.getByTestId('channel-name-input').fill('inbox')
  await page.getByTestId('channel-name-input').press('Enter')
  await expect(page.getByTestId('channel-inbox')).toBeVisible()
  await page.getByTestId('channel-inbox').click()
  await expect(page.getByTestId('channel-title')).toHaveText('# inbox')

  await page.getByTestId('composer-input').fill('hello memo')
  await page.getByTestId('composer-input').press('Shift+Enter')
  await expect(page.getByText('hello memo')).toBeVisible()

  await page.getByText('スレッドで返信').click()
  await expect(page.getByTestId('thread-panel')).toBeVisible()
  await page.getByTestId('thread-composer').locator('[data-testid="composer-input"]').fill('thread reply')
  await page.getByTestId('thread-composer').locator('[data-testid="composer-input"]').press('Shift+Enter')
  await expect(page.getByText('thread reply')).toBeVisible()

  await page.getByTestId('new-channel-button').click()
  await page.getByTestId('channel-name-input').fill('other')
  await page.getByTestId('channel-name-input').press('Enter')
  await expect(page.getByTestId('channel-other')).toBeVisible()
  await dragByMouse(page, 'channel-drag-inbox', 'channel-row-other')
  await expect(page.getByTestId('channel-inbox')).toBeVisible()
  await expect(page.getByTestId('channel-row-inbox')).toHaveAttribute('data-depth', '1')

  await page.reload()
  await expect(page.getByTestId('channel-tree')).toBeVisible()
  await expect(page.getByTestId('channel-other')).toBeVisible()
  await expect(page.getByTestId('channel-inbox')).toBeVisible()
  await expect(page.getByTestId('channel-title')).toHaveText('# other')
  await page.getByTestId('channel-inbox').click()
  await expect(page.getByTestId('channel-title')).toHaveText('# inbox')
  await expect(page.getByText('hello memo')).toBeVisible()
})

test('emoji reactions filter, roll back, toggle, and work in replies', async ({ page }) => {
  await installApiMock(page)
  await page.goto('/')

  await page.getByTestId('new-channel-button').click()
  await page.getByTestId('channel-name-input').fill('reactions')
  await page.getByTestId('channel-name-input').press('Enter')
  await page.getByTestId('channel-reactions').click()
  await page.getByTestId('composer-input').fill('emoji memo')
  await page.getByTestId('composer-input').press('Shift+Enter')

  const post = page.locator('article').filter({ hasText: 'emoji memo' })
  const reactionTrigger = post.getByRole('button', { name: 'リアクションを追加' })
  await reactionTrigger.click()
  const picker = page.getByRole('dialog', { name: 'リアクションを追加' })
  await expect(picker).toHaveJSProperty('tagName', 'DIALOG')
  await page.keyboard.press('Escape')
  await expect(picker).toHaveCount(0)
  await expect(reactionTrigger).toBeFocused()
  await reactionTrigger.click()
  await expect(picker.getByRole('button', { name: ':shipit:' })).toBeVisible()
  await expect(picker.getByRole('button', { name: ':party:' })).toBeVisible()
  await picker.getByRole('searchbox', { name: 'ショートコードで絞り込み' }).fill('fail')
  await expect(picker.getByRole('button', { name: ':shipit:' })).toHaveCount(0)
  await picker.getByRole('button', { name: ':fail:' }).click()

  await expect(post.getByRole('button', { name: /:fail: 1件/ })).toBeVisible()
  await expect(post.getByRole('alert')).toContainText('元の状態に戻しました')
  await expect(post.getByRole('button', { name: /:fail:/ })).toHaveCount(0)

  await post.getByRole('button', { name: 'リアクションを追加' }).click()
  await page.getByRole('dialog', { name: 'リアクションを追加' }).getByRole('button', { name: ':party:' }).click()
  const party = post.getByRole('button', { name: /:party: 1件/ })
  await expect(party).toHaveAttribute('aria-pressed', 'true')
  await party.hover()
  await expect(post.getByRole('tooltip')).toContainText('自分')
  await party.click()
  await expect(post.getByRole('button', { name: /:party:/ })).toHaveCount(0)

  await post.getByRole('button', { name: 'スレッドで返信' }).click()
  const panel = page.getByTestId('thread-panel')
  await panel.getByTestId('composer-input').fill('reply reaction')
  await panel.getByTestId('composer-input').press('Shift+Enter')
  const reply = panel.locator('article').filter({ hasText: 'reply reaction' })
  await reply.getByRole('button', { name: 'リアクションを追加' }).click()
  await page.getByRole('dialog', { name: 'リアクションを追加' }).getByRole('button', { name: ':shipit:' }).click()
  await expect(reply.getByRole('button', { name: /:shipit: 1件/ })).toHaveAttribute('aria-pressed', 'true')
})

test('edits and deletes a thread reply and refreshes the root reply count', async ({ page }) => {
  await installApiMock(page)
  await page.goto('/')

  await page.getByTestId('new-channel-button').click()
  await page.getByTestId('channel-name-input').fill('reply-actions')
  await page.getByTestId('channel-name-input').press('Enter')
  await page.getByTestId('channel-reply-actions').click()
  await page.getByTestId('composer-input').fill('root memo')
  await page.getByTestId('composer-input').press('Shift+Enter')

  const root = page.getByTestId('timeline').locator('article').filter({ hasText: 'root memo' })
  await root.getByRole('button', { name: 'スレッドで返信' }).click()
  const panel = page.getByTestId('thread-panel')
  await panel.getByTestId('composer-input').fill('reply before edit')
  await panel.getByTestId('composer-input').press('Shift+Enter')
  await expect(root.getByRole('button', { name: /1 件の返信/ })).toBeVisible()

  let reply = panel.locator('article').filter({ hasText: 'reply before edit' })
  await reply.hover()
  const editTrigger = reply.getByRole('button', { name: /返信を編集/ })
  await editTrigger.click()
  const editDialog = page.getByRole('dialog', { name: '返信を編集' })
  await expect(editDialog).toHaveJSProperty('tagName', 'DIALOG')
  await page.keyboard.press('Escape')
  await expect(editDialog).toHaveCount(0)
  await expect(editTrigger).toBeFocused()
  await editTrigger.click()
  await editDialog.getByLabel('本文').fill('reply after edit')
  await editDialog.getByRole('button', { name: '保存' }).click()
  await expect(panel.getByText('reply after edit')).toBeVisible()

  reply = panel.locator('article').filter({ hasText: 'reply after edit' })
  await reply.hover()
  page.once('dialog', (dialog) => dialog.accept())
  await reply.getByRole('button', { name: /返信を削除/ }).click()
  await expect(panel.getByText('reply after edit')).toHaveCount(0)
  await expect(root.getByRole('button', { name: 'スレッドで返信' })).toBeVisible()
})

test('searches Japanese posts and focuses root and reply source positions', async ({ page }) => {
  const mock = await installApiMock(page)
  const scenario = mock.seedSearchScenario()
  await page.goto('/')
  await page.getByTestId('channel-検索メモ').click()
  await expect(page.getByTestId(`post-${scenario.root.id}`)).toHaveCount(0)

  await page.keyboard.press('Control+K')
  const dialog = page.getByRole('dialog', { name: 'ポストを検索' })
  await expect(dialog).toBeVisible()
  await dialog.getByLabel('検索語').fill('日')
  await dialog.getByRole('button', { name: '検索', exact: true }).click()
  await expect(dialog.getByText('検索語は2文字以上で入力してください')).toBeVisible()

  await dialog.getByLabel('検索語').fill('日本語')
  await dialog.getByRole('button', { name: '検索', exact: true }).click()
  await expect(dialog.locator('mark').getByText('日本語')).toBeVisible()
  await dialog.getByRole('button').filter({ hasText: scenario.root.body }).click()
  const root = page.getByTestId(`post-${scenario.root.id}`)
  await expect(root).toBeVisible()
  await expect(root).toBeFocused()
  await expect(page.getByRole('button', { name: '最新のポストへ戻る' })).toBeVisible()

  await page.keyboard.press('Control+K')
  await dialog.getByLabel('検索語').fill('返信検索')
  await dialog.getByRole('button', { name: '検索', exact: true }).click()
  await dialog.getByRole('button').filter({ hasText: scenario.reply.body }).click()
  await expect(page.getByTestId('thread-panel')).toBeVisible()
  await expect(page.locator(`#thread-reply-${scenario.reply.id}`)).toBeFocused()
})

test('blocks mutations offline, preserves a draft, and refreshes missed posts after recovery', async ({ page }) => {
  const mock = await installApiMock(page)
  const seeded = mock.seedChannel('同期メモ', ['既存のメモ'])
  await page.goto('/')
  await page.getByTestId('channel-同期メモ').click()
  await expect(page.getByText('既存のメモ')).toBeVisible()
  await expect(page.getByTestId('connection-error')).toHaveCount(0)

  await mock.disconnect()
  await expect(page.getByRole('alert')).toContainText('接続されていません')
  const composer = page.getByTestId('composer-input')
  await composer.fill('切断中も残る下書き')
  await expect(composer).toBeEnabled()
  await expect(page.getByRole('button', { name: '送信' })).toBeDisabled()
  await expect(page.getByTestId('new-channel-button')).toBeDisabled()

  await mock.createExternalPost(seeded.channel.id, '切断中に追加されたメモ')
  await mock.reconnect()
  await expect(page.getByText('切断中に追加されたメモ')).toBeVisible()
  await expect(page.getByTestId('connection-error')).toHaveCount(0)
  await expect(composer).toHaveValue('切断中も残る下書き')
  await expect(page.getByRole('button', { name: '送信' })).toBeEnabled()
  await composer.press('Shift+Enter')
  await expect(page.getByText('切断中も残る下書き')).toBeVisible()
})

test('app shell fits a small window without document scrolling', async ({ page }) => {
  await installApiMock(page)
  await page.setViewportSize({ width: 900, height: 520 })
  await page.goto('/')
  await page.getByTestId('new-channel-button').click()
  await page.getByTestId('channel-name-input').fill('inbox')
  await page.getByTestId('channel-name-input').press('Enter')
  await page.getByTestId('channel-inbox').click()
  await expect(page.getByTestId('channel-title')).toHaveText('# inbox')

  const fit = await page.evaluate(() => ({
    docHeight: document.documentElement.scrollHeight,
    innerHeight: window.innerHeight,
  }))
  expect(fit.docHeight).toBeLessThanOrEqual(fit.innerHeight)
  await expect(page.getByTestId('composer-input')).toBeInViewport()
})

test('keeps the newest post in view after posting', async ({ page }) => {
  await installApiMock(page)
  await page.setViewportSize({ width: 1000, height: 700 })
  await page.goto('/')
  await page.getByTestId('new-channel-button').click()
  await page.getByTestId('channel-name-input').fill('inbox')
  await page.getByTestId('channel-name-input').press('Enter')
  await page.getByTestId('channel-inbox').click()
  await expect(page.getByTestId('channel-title')).toHaveText('# inbox')

  const composer = page.getByTestId('composer-input')
  const long = 'あ'.repeat(400)
  for (let i = 0; i < 8; i++) {
    await composer.fill(`長文ポスト${i} ${long}`)
    await composer.press('Shift+Enter')
    await expect(page.getByText(`長文ポスト${i} `)).toBeVisible()
  }

  const timeline = page.getByTestId('timeline')
  await expect
    .poll(() => timeline.evaluate((el) => el.scrollHeight - el.clientHeight - Math.round(el.scrollTop)))
    .toBeLessThanOrEqual(1)
  await expect(timeline.locator('article').last()).toBeInViewport({ ratio: 1 })
})

test('Enter inserts a newline and Shift+Enter sends it as a line break', async ({ page }) => {
  await installApiMock(page)
  await page.goto('/')
  await page.getByTestId('new-channel-button').click()
  await page.getByTestId('channel-name-input').fill('inbox')
  await page.getByTestId('channel-name-input').press('Enter')
  await page.getByTestId('channel-inbox').click()

  const composer = page.getByTestId('composer-input')
  await composer.fill('1行目')
  await composer.press('Enter')
  await composer.type('2行目')
  await expect(composer).toHaveValue('1行目\n2行目')

  await composer.press('Shift+Enter')
  await expect(composer).toHaveValue('')
  const body = page.getByTestId('markdown-body').first()
  await expect(body).toContainText('1行目')
  expect(await body.locator('br').count()).toBe(1)
})

test('narrow stack navigates channel timeline thread without forcing horizontal scroll', async ({ page }) => {
  await installApiMock(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await expect(page.getByTestId('narrow-shell')).toBeVisible()
  await expect(page.getByTestId('sidebar')).toHaveCount(0)

  await page.getByTestId('new-channel-button').click()
  await page.getByTestId('channel-name-input').fill('inbox')
  await page.getByTestId('channel-name-input').press('Enter')
  await expect(page.getByTestId('channel-title')).toHaveText('# inbox')
  await expect(page.getByTestId('timeline')).toBeVisible()
  await expect(page.getByTestId('channel-tree')).toHaveCount(0)

  await page.getByTestId('composer-input').fill('hello memo')
  await page.getByRole('button', { name: '送信' }).click()
  await expect(page.getByText('hello memo')).toBeVisible()

  await page.getByText('スレッドで返信').click()
  await expect(page.getByTestId('thread-panel')).toBeVisible()
  await expect(page.getByTestId('timeline')).toHaveCount(0)

  await page.getByTestId('narrow-back').click()
  await expect(page.getByTestId('timeline')).toBeVisible()
  await expect(page.getByTestId('channel-title')).toHaveText('# inbox')

  await page.getByTestId('narrow-back').click()
  await expect(page.getByTestId('channel-tree')).toBeVisible()
  await expect(page.getByTestId('channel-inbox')).toBeVisible()

  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }))
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth)
})

test('narrow shell keeps long links and code blocks inside the viewport width', async ({ page }) => {
  const mock = await installApiMock(page)
  const longUrl = 'https://example.com/very/long/path/that/never/breaks/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa?q=bbbbbbbbbbbbbbbbbbbbbbbb'
  const codeBlock = '```ts\nconst veryLongIdentifierName = someFunctionCall(argumentOne, argumentTwo, argumentThree)\n```'
  const { posts } = mock.seedChannel('inbox', [longUrl, 'ABCDEFGHIJKLMNOPQRSTUVWXYZABCDEFGHIJKLMNOPQRSTUVWXYZABCDEFGHIJKL', codeBlock])
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await page.getByTestId('channel-inbox').click()
  await expect(page.getByTestId('timeline')).toBeVisible()
  await expect(page.getByTestId('code-block')).toBeVisible()

  // 横スクロールはコードブロック等の専用スクローラだけに閉じ込め、シェルと本文には出さない。
  const timelineFit = await page.evaluate(() => {
    const shell = document.querySelector('[data-testid="narrow-shell"]')!
    const timeline = document.querySelector('[data-testid="timeline"]')!
    return {
      shellOverflow: shell.scrollWidth - shell.clientWidth,
      timelineOverflow: timeline.scrollWidth - timeline.clientWidth,
    }
  })
  expect(timelineFit.shellOverflow).toBeLessThanOrEqual(0)
  expect(timelineFit.timelineOverflow).toBeLessThanOrEqual(0)

  await page.getByTestId(`post-${posts[0]!.id}`).getByText('スレッドで返信').click()
  await expect(page.getByTestId('thread-panel')).toBeVisible()
  // パネルは右から差し込むので、登場アニメーションが終わってから幅を測る。
  // スレッドの縦スクローラも横には溢れさせない（コードブロックは自前のスクローラで横スクロールする）。
  await expect
    .poll(() =>
      page.evaluate(() => {
        const shell = document.querySelector('[data-testid="narrow-shell"]')!
        const panel = document.querySelector('[data-testid="thread-panel"]')!
        const scroller = panel.firstElementChild!
        return Math.max(
          shell.scrollWidth - shell.clientWidth,
          panel.scrollWidth - panel.clientWidth,
          scroller.scrollWidth - scroller.clientWidth,
        )
      }),
    )
    .toBeLessThanOrEqual(0)
})

test('wide window keeps posts full width and left aligned with a padded composer', async ({ page }) => {
  const mock = await installApiMock(page)
  mock.seedChannel('inbox', ['幅の確認用ポスト'])
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await page.getByTestId('channel-inbox').click()
  await expect(page.getByTestId('timeline')).toBeVisible()

  const measure = () =>
    page.evaluate(() => {
      const scroller = document.querySelector('[data-testid="timeline"]')!
      const content = scroller.querySelector(':scope > div:nth-child(2)')!
      const article = scroller.querySelector('article')!
      const form = document.querySelector('[data-testid="composer"]')!
      const card = form.querySelector(':scope > div')!
      const style = getComputedStyle(scroller)
      const scrollerRect = scroller.getBoundingClientRect()
      return {
        // 本文は読み幅で絞らず、スクローラのパディング内いっぱいを左寄せで使う
        contentWidth: Math.round(content.getBoundingClientRect().width),
        contentInner: Math.round(
          scroller.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
        ),
        // 入力カードの左端はポストの本文ブロックの左端と揃い、右端にも同じ余白が残る
        articleLeft: Math.round(article.getBoundingClientRect().left - scrollerRect.left),
        cardLeft: Math.round(card.getBoundingClientRect().left - form.getBoundingClientRect().left),
        cardRight: Math.round(form.getBoundingClientRect().right - card.getBoundingClientRect().right),
        cardBottom: Math.round(form.getBoundingClientRect().bottom - card.getBoundingClientRect().bottom),
        // 折り返すと高さが倍になるので、行数はツールバー高 ÷ ボタン行高で見る
        toolbarRows: Math.round(
          card.firstElementChild!.getBoundingClientRect().height /
            card.firstElementChild!.querySelector('button')!.getBoundingClientRect().height,
        ),
      }
    })

  const wide = await measure()
  expect(wide.contentWidth).toBe(wide.contentInner)
  expect(wide.contentInner).toBeGreaterThan(1000)
  expect(wide.cardLeft).toBe(16)
  expect(wide.cardRight).toBe(16)
  expect(wide.cardBottom).toBe(16)
  expect(wide.cardLeft).toBe(wide.articleLeft)

  // 狭幅では書式ツールバーを 1 段に保つため、入力カードは端まで使う。
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.getByTestId('narrow-shell')).toBeVisible()
  const narrow = await measure()
  expect(narrow.contentWidth).toBe(narrow.contentInner)
  expect(narrow.cardLeft).toBe(0)
  expect(narrow.cardRight).toBe(0)
  expect(narrow.cardBottom).toBe(0)
  expect(narrow.toolbarRows).toBe(1)
})

test('touch devices keep form controls at 16px so iOS does not auto zoom', async ({ browser }, testInfo) => {
  // iOS は 16px 未満のフォーム部品にユーザー操作でフォーカスするとページを自動拡大し、
  // 拡大が残ったままリロードするまで横スクロールが消えない。Composer はマウント時に
  // textarea へ focus() するので、チャネルやスレッドを開くたびに踏んでいた。
  const context = await browser.newContext({
    ...devices['Pixel 5'],
    locale: 'ja-JP',
    baseURL: testInfo.project.use.baseURL,
  })
  const page = await context.newPage()
  try {
    const mock = await installApiMock(page)
    const { posts } = mock.seedChannel('inbox', ['ポスト'])
    await page.goto('/')
    await page.getByTestId('channel-inbox').click()
    await expect(page.getByTestId('timeline')).toBeVisible()

    const timeline = await page.evaluate(() => {
      const input = document.querySelector('[data-testid="composer-input"]') as HTMLElement
      return { size: parseFloat(getComputedStyle(input).fontSize), focused: document.activeElement === input }
    })
    expect(timeline.focused).toBe(true)
    expect(timeline.size).toBeGreaterThanOrEqual(16)

    await page.getByTestId(`post-${posts[0]!.id}`).getByText('スレッドで返信').click()
    await expect(page.getByTestId('thread-panel')).toBeVisible()
    const sizes = await page.evaluate(() =>
      [...document.querySelectorAll('input, select, textarea')].map((el) =>
        parseFloat(getComputedStyle(el).fontSize),
      ),
    )
    expect(sizes.length).toBeGreaterThan(0)
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(16)
  } finally {
    await context.close()
  }
})

test('narrow shell starts on the channel list even when a channel was open', async ({ page }) => {
  const mock = await installApiMock(page)
  mock.seedChannel('inbox', ['ポスト'])
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await page.getByTestId('channel-inbox').click()
  await expect(page.getByTestId('timeline')).toBeVisible()

  // リロードしてもチャネル一覧から始まる（選択自体は保持される）
  await page.reload()
  await expect(page.getByTestId('channel-tree')).toBeVisible()
  await expect(page.getByTestId('timeline')).toHaveCount(0)

  // 履歴 state も一覧に揃うので、開き直したあとの「戻る」が一覧に帰ってくる
  await page.getByTestId('channel-inbox').click()
  await expect(page.getByTestId('timeline')).toBeVisible()
  await page.getByTestId('narrow-back').click()
  await expect(page.getByTestId('channel-tree')).toBeVisible()

  // 広幅はサイドバーに一覧が常時見えているので、前回のチャネルを開いたままにする
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.getByTestId('channel-inbox').click()
  await expect(page.getByTestId('channel-title')).toHaveText('# inbox')
  await page.reload()
  await expect(page.getByTestId('channel-title')).toHaveText('# inbox')
  await expect(page.getByTestId('timeline')).toBeVisible()
})
