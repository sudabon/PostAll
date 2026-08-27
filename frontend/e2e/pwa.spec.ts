import { expect, test } from '@playwright/test'

test.describe('pwa', () => {
  test('serves a web manifest and icons', async ({ request }) => {
    const manifestRes = await request.get('/manifest.webmanifest')
    expect(manifestRes.ok()).toBeTruthy()
    const manifest = (await manifestRes.json()) as { name: string; display: string; icons: { src: string }[] }
    expect(manifest.name).toBe('PostAll')
    expect(manifest.display).toBe('standalone')
    expect(manifest.icons.length).toBeGreaterThan(0)
    const icon = await request.get('/icons/icon-192.png')
    expect(icon.ok()).toBeTruthy()
    expect(icon.headers()['content-type']).toMatch(/png/)
  })

  test('service worker does not cache API routes', async ({ request }) => {
    const sw = await request.get('/sw.js')
    expect(sw.ok()).toBeTruthy()
    const body = await sw.text()
    expect(body).toMatch(/NetworkOnly/)
    expect(body).toMatch(/\/v1\//)
    expect(body).toMatch(/cleanupOutdatedCaches/)
  })

  test('keeps the PKCE verifier when browser sign-in returns to the callback', async ({ page }) => {
    let tokenBody: string | null = null
    await page.addInitScript(() => {
      localStorage.setItem('postall:settings', JSON.stringify({
        apiBaseUrl: '',
        supabaseUrl: 'https://auth.example.test',
        supabasePublishableKey: 'pwa-anon-key',
        theme: 'system',
      }))
    })
    await page.goto('/')
    const origin = new URL(page.url()).origin
    await page.route('https://auth.example.test/auth/v1/authorize**', async (route) => {
      const authorize = new URL(route.request().url())
      const redirectUri = authorize.searchParams.get('redirect_to')
      expect(redirectUri).toBe(`${origin}/auth/callback`)
      await route.fulfill({
        status: 302,
        headers: { location: `${redirectUri}?code=authorization-code` },
      })
    })
    await page.route('https://auth.example.test/auth/v1/token**', async (route) => {
      if (route.request().method() === 'OPTIONS') {
        await route.fulfill({
          status: 204,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'content-type, apikey',
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
          },
        })
        return
      }
      tokenBody = route.request().postData()
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { 'Access-Control-Allow-Origin': '*' },
        json: { access_token: 'access-token', refresh_token: 'refresh-token', expires_in: 3600 },
      })
    })
    await page.route('**/health', (route) => route.fulfill({ json: { status: 'ok', database: 'ok' } }))
    await page.route('**/v1/**', async (route) => {
      const url = new URL(route.request().url())
      if (!url.pathname.startsWith('/v1/')) {
        await route.fallback()
        return
      }
      if (url.pathname === '/v1/events') {
        await route.fulfill({ json: { events: [], nextAfter: '0', hasMore: false } })
        return
      }
      if (url.pathname === '/v1/channels') {
        await route.fulfill({ json: { channels: [] } })
        return
      }
      if (url.pathname === '/v1/emojis') {
        await route.fulfill({ json: { emojis: [] } })
        return
      }
      await route.fulfill({ status: 404, json: { code: 'not_found', message: url.pathname } })
    })

    await page.goto('/')
    await expect(page.getByTestId('sign-in-button')).toBeEnabled()
    await page.getByTestId('sign-in-button').click()
    await expect.poll(() => tokenBody).not.toBeNull()
    const tokenJson = JSON.parse(tokenBody ?? '{}') as { auth_code?: string; code_verifier?: string }
    expect(tokenJson.auth_code).toBe('authorization-code')
    expect(tokenJson.code_verifier).toBeTruthy()
    await expect(page.getByTestId('sign-in-button')).toHaveCount(0)
    await expect(page.getByTestId('channel-tree')).toBeVisible()
  })

  test('shows the app shell and an offline error without cached channel data', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByTestId('sign-in-button')).toBeVisible()
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.waitForFunction(() => navigator.serviceWorker.controller != null)
    await page.context().setOffline(true)
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false })
    })
    await page.reload({ waitUntil: 'domcontentloaded' })
    await expect(page.getByRole('heading', { name: 'PostAll' })).toBeVisible()
    await expect(page.getByTestId('connection-error')).toBeVisible()
    await expect(page.getByTestId('channel-tree')).toHaveCount(0)
  })
})
