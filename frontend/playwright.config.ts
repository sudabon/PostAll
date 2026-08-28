import { defineConfig, devices } from '@playwright/test'

const appPort = Number(process.env.POSTALL_E2E_APP_PORT ?? 4173)
const pwaPort = Number(process.env.POSTALL_E2E_PWA_PORT ?? 4174)

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  retries: 0,
  use: {
    locale: 'ja-JP',
    reducedMotion: 'reduce',
    trace: 'on-first-retry',
  },
  webServer: [
    {
      command: `npx vite --host 127.0.0.1 --port ${appPort} --strictPort`,
      url: `http://127.0.0.1:${appPort}`,
      reuseExistingServer: !process.env.CI,
      env: { VITE_E2E: 'true' },
    },
    {
      command: `npx vite build && npx vite preview --host 127.0.0.1 --port ${pwaPort} --strictPort`,
      url: `http://127.0.0.1:${pwaPort}`,
      reuseExistingServer: !process.env.CI,
    },
  ],
  projects: [
    { name: 'app', testMatch: /app\.spec\.ts/, use: { ...devices['Desktop Chrome'], baseURL: `http://127.0.0.1:${appPort}` } },
    { name: 'pwa', testMatch: /pwa\.spec\.ts/, use: { ...devices['Desktop Chrome'], baseURL: `http://127.0.0.1:${pwaPort}` } },
  ],
})
