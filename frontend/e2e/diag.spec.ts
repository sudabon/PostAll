import { installApiMock, expect, test } from './mock'

const CASES: Record<string, string> = {
  longUrl: 'https://example.com/very/long/path/that/never/breaks/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa?q=bbbbbbbbbbbb',
  code: '```ts\nconst veryLongIdentifierName = someFunctionCall(argumentOne, argumentTwo, argumentThree)\n```',
  table: '| 項目名がそこそこ長い列 | 二列目もそれなりに長い | 三列目 | 四列目 | 五列目 |\n| --- | --- | --- | --- | --- |\n| aaaaaaa | bbbbbbb | ccccccc | ddddddd | eeeeeee |',
  mermaid: '```mermaid\ngraph LR\n  A[開始してから長めのラベル] --> B[次の処理も長めのラベル] --> C[さらに次の処理] --> D[終了]\n```',
  nested: '- 第一階層の項目\n  - 第二階層の項目\n    - 第三階層の項目\n      - 第四階層でそれなりに長い説明文が入る場合の折り返し確認\n        - 第五階層',
  quote: '> 引用の中に長いURLがある場合 https://example.com/quoted/very/long/path/aaaaaaaaaaaaaaaaaaaaaaaa',
  inlineCode: '`veryLongInlineCodeIdentifierThatDoesNotBreakAnywhereAtAll_1234567890` を参照',
}

for (const [orientation, size] of [['portrait', { width: 390, height: 844 }], ['landscape', { width: 844, height: 390 }]] as const) {
  test(`thread overflow ${orientation}`, async ({ page }) => {
    const mock = await installApiMock(page)
    const { posts } = mock.seedChannel('inbox', ['スレッド親'])
    await page.setViewportSize(size)
    await page.goto('/')
    await page.getByTestId('channel-inbox').click()
    await page.getByTestId(`post-${posts[0]!.id}`).getByText('スレッドで返信').click()
    await expect(page.getByTestId('thread-panel')).toBeVisible()

    const input = page.getByTestId('thread-composer').locator('[data-testid="composer-input"]')
    for (const body of Object.values(CASES)) {
      await input.fill(body)
      await input.press('Shift+Enter')
      await expect(input).toHaveValue('')
    }
    await page.waitForTimeout(2500)

    const out = await page.evaluate(() => {
      const vw = document.documentElement.clientWidth
      const label = (el: Element): string => {
        const e = el as HTMLElement
        return `${el.tagName.toLowerCase()}${e.dataset?.testid ? `[${e.dataset.testid}]` : ''}.${(el.className?.toString() ?? '').slice(0, 60)}`
      }
      const rows: unknown[] = []
      document.querySelectorAll<HTMLElement>('*').forEach((el) => {
        if (el.scrollWidth > el.clientWidth + 0.5 || el.getBoundingClientRect().right > vw + 0.5) {
          rows.push({
            el: label(el),
            parent: el.parentElement ? label(el.parentElement) : '',
            right: Math.round(el.getBoundingClientRect().right),
            scrollW: el.scrollWidth, clientW: el.clientWidth,
            overflowX: getComputedStyle(el).overflowX,
          })
        }
      })
      return { vw, wide: window.matchMedia('(min-width: 768px)').matches, rows }
    })
    console.log(`--- ${orientation} ---`, JSON.stringify(out, null, 1))
  })
}
