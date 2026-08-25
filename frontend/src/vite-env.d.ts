/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL: string
  readonly VITE_COGNITO_DOMAIN: string
  readonly VITE_COGNITO_CLIENT_ID: string
  readonly VITE_E2E: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

interface PostallPlatformBridge {
  kind: 'electron'
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>
  on: (channel: string, listener: (payload: unknown) => void) => () => void
}

interface Window {
  postallPlatform?: PostallPlatformBridge
}
