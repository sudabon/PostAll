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
