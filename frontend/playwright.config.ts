import { defineConfig, devices } from '@playwright/test'

const appPort = Number(process.env.POSTALL_E2E_APP_PORT ?? 4173)
const pwaPort = Number(process.env.POSTALL_E2E_PWA_PORT ?? 4174)
const cspPort = Number(process.env.POSTALL_E2E_CSP_PORT ?? 4175)
// build:pwa-preview の Supabase。CSP の connect-src はビルド時の値で決まるので、
// pwa.spec.ts のサインイン経路がモックする origin と一致させる。
const pwaSupabaseUrl = 'https://auth.example.test'
// build:csp-e2e の出力先。pwa のビルド（dist）と並行して走るので分ける。
const cspOutDir = 'dist-csp-e2e'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  retries: 1,
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
      env: { VITE_SUPABASE_URL: pwaSupabaseUrl },
    },
    {
      // build:csp-e2e: CSP は本番ビルドにだけ付くので、サインイン済みのモックで描画するには
      // VITE_E2E=true の本番ビルドを preview で配る。
      command: `npx vite build --outDir ${cspOutDir} --emptyOutDir && npx vite preview --outDir ${cspOutDir} --host 127.0.0.1 --port ${cspPort} --strictPort`,
      url: `http://127.0.0.1:${cspPort}`,
      reuseExistingServer: !process.env.CI,
      env: { VITE_E2E: 'true' },
    },
  ],
  projects: [
    {
      name: 'app',
      testMatch: /(app|stamp-upload|security|encryption)\.spec\.ts/,
      // TP-032 は iPhone 相当の WebKit でだけ観測する（browser:webkit-iphone）。
      grepInvert: /@TP-032\b/,
      use: { ...devices['Desktop Chrome'], baseURL: `http://127.0.0.1:${appPort}` },
    },
    {
      // browser:webkit-iphone: iPhone の PWA 相当。WebKit の端末エミュレーションで、
      // 取り出せない鍵を IndexedDB に記憶できることを見る。対象は TP-032 だけ。
      name: 'webkit-iphone',
      testMatch: /encryption\.spec\.ts/,
      grep: /@TP-032\b/,
      use: { ...devices['iPhone 15'], baseURL: `http://127.0.0.1:${appPort}` },
    },
    { name: 'pwa', testMatch: /pwa\.spec\.ts/, use: { ...devices['Desktop Chrome'], baseURL: `http://127.0.0.1:${pwaPort}` } },
    { name: 'csp', testMatch: /csp\.spec\.ts/, use: { ...devices['Desktop Chrome'], baseURL: `http://127.0.0.1:${cspPort}` } },
  ],
  reporter: [['list'], ['json', { outputFile: 'test-results/e2e-results.json' }]],
})
