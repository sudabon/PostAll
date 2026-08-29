import { defineConfig, devices } from '@playwright/test'
const appPort = Number(process.env.POSTALL_E2E_APP_PORT ?? 4173)
export default defineConfig({
  testDir: './e2e', fullyParallel: false, retries: 0,
  use: { locale: 'ja-JP' },
  webServer: [{ command: `npx vite --host 127.0.0.1 --port ${appPort} --strictPort`, url: `http://127.0.0.1:${appPort}`, reuseExistingServer: true, env: { VITE_E2E: 'true' } }],
  projects: [{ name: 'diag', testMatch: /diag\.spec\.ts/, use: { ...devices['iPhone 14'], baseURL: `http://127.0.0.1:${appPort}` } }],
})
