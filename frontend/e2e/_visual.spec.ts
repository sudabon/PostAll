import { installApiMock, expect, test } from './mock'

const OUT = '/private/tmp/claude-501/-Users-suda-workspace-sudabon-PostAll/3cae3db8-a1ae-4dab-bcb6-b7714d4bc452/scratchpad'

test('visual check of the new channel row and composer toolbar', async ({ page }) => {
  await installApiMock(page)
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto('/')
  await expect(page.getByTestId('channel-tree')).toBeVisible()

  await page.getByTestId('new-channel-button').click()
  await page.getByTestId('channel-name-input').fill('inbox')
  await page.getByTestId('channel-name-input').press('Enter')
  await page.getByTestId('channel-inbox').click()
  await expect(page.getByTestId('channel-title')).toHaveText('# inbox')

  // 1. チャネル行: ホバーでゴミ箱アイコンのみ
  await page.getByTestId('channel-row-inbox').hover()
  await expect(page.getByTestId('channel-delete-inbox')).toBeVisible()
  await expect(page.getByRole('button', { name: '改名' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '子' })).toHaveCount(0)
  await page.getByTestId('channel-tree').screenshot({ path: `${OUT}/01-channel-row.png` })

  // 2. ツールバーで書式を挿入
  const input = page.getByTestId('composer-input')
  await input.fill('太字にする')
  await input.evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(0, 5))
  await page.getByTestId('composer-format-bold').click()
  await expect(input).toHaveValue('**太字にする**')

  await input.fill('a\nb')
  await input.evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(0, 3))
  await page.getByTestId('composer-format-orderedList').click()
  await expect(input).toHaveValue('1. a\n2. b')

  await input.fill('')
  await page.getByTestId('composer-format-underline').click()
  await expect(input).toHaveValue('<u></u>')

  await input.fill('')
  await page.getByTestId('composer').screenshot({ path: `${OUT}/02-composer.png` })

  // 3. 全書式を投稿して描画を確認
  await input.fill(
    [
      '**太字** *斜体* <u>下線</u> ~~取り消し線~~ `コード`',
      '',
      '[リンク](https://example.com)',
      '',
      '1. 数字1',
      '2. 数字2',
      '',
      '- 箇条1',
      '- 箇条2',
      '',
      '> 引用',
      '',
      '```js',
      'const x = 1',
      '```',
    ].join('\n'),
  )
  await page.getByRole('button', { name: '送信' }).click()
  await expect(page.getByText('下線')).toBeVisible()
  await expect(page.locator('.markdown-body u')).toHaveText('下線')
  await page.getByTestId('timeline').screenshot({ path: `${OUT}/03-rendered.png` })

  // 4. チャネル名のダブルクリックで改名モード
  await page.getByTestId('channel-inbox').dblclick()
  await expect(page.getByTestId('channel-name-input')).toBeVisible()
  await page.getByTestId('channel-name-input').fill('受信箱')
  await page.getByTestId('channel-name-input').press('Enter')
  await expect(page.getByTestId('channel-受信箱')).toBeVisible()
  await page.getByTestId('channel-tree').screenshot({ path: `${OUT}/04-renamed.png` })
})
