import { REJECTED_ACCESS_TOKEN, expect, installApiMock, test } from './mock'

const CHANGE = '@harden-sensitive-data-protection'
const NOTICE = 'このアカウントでは利用が許可されていません'

test(
  '許可されていないアカウントはサインイン画面へ戻り、案内が出て端末のトークンが消える',
  { tag: [CHANGE, '@TP-001'] },
  async ({ page }) => {
    // fixture: mock:account-not-allowed
    const mock = await installApiMock(page, { accountNotAllowed: true })
    mock.seedChannel('秘密のチャネル', ['見えてはいけないメモ'])

    await page.goto('/')

    await expect(page.getByTestId('sign-in-button')).toBeVisible()
    await expect(page.getByTestId('auth-error')).toHaveText(NOTICE)
    await expect(page.getByTestId('channel-tree')).toHaveCount(0)
    await expect(page.getByTestId('timeline')).toHaveCount(0)
    await expect(page.getByText('秘密のチャネル')).toHaveCount(0)
    await expect(page.getByText('見えてはいけないメモ')).toHaveCount(0)
    expect(mock.v1Requests().some((r) => r.authorization === `Bearer ${REJECTED_ACCESS_TOKEN}`)).toBe(true)
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem('postall:secret:auth.tokens')))
      .toBeNull()
  },
)

test(
  '並行した拒否でも案内は 1 つだけで、サインイン画面に戻った後は /v1/* を送らない',
  { tag: [CHANGE, '@TP-002'] },
  async ({ page }) => {
    // fixture: mock:account-not-allowed
    const mock = await installApiMock(page, { accountNotAllowed: true })

    await page.goto('/')
    await expect(page.getByTestId('sign-in-button')).toBeVisible()
    await expect(page.getByTestId('auth-error')).toHaveCount(1)
    const rejected = mock.v1Requests()
    expect(rejected.length).toBeGreaterThanOrEqual(2)
    expect(rejected.every((r) => r.authorization === `Bearer ${REJECTED_ACCESS_TOKEN}`)).toBe(true)

    // 再試行（既定 1 秒 → 2 秒の間隔）や差分のポーリングが走るなら、この間に現れる。
    await page.waitForTimeout(4_000)

    expect(mock.v1Requests().slice(rejected.length)).toEqual([])
    await expect(page.getByTestId('auth-error')).toHaveCount(1)
    await expect(page.getByTestId('auth-error')).toHaveText(NOTICE)
  },
)
