import { create } from 'zustand'
import type { PlatformAdapter } from '@/platform'

export type ThemePref = 'light' | 'dark' | 'system'

export type Settings = {
  apiBaseUrl: string
  cognitoDomain: string
  cognitoClientId: string
  theme: ThemePref
}

const defaults: Settings = {
  apiBaseUrl: import.meta.env.VITE_API_BASE_URL ?? '',
  cognitoDomain: import.meta.env.VITE_COGNITO_DOMAIN ?? '',
  cognitoClientId: import.meta.env.VITE_COGNITO_CLIENT_ID ?? '',
  theme: 'system',
}

type SettingsState = Settings & {
  hydrate: (partial: Partial<Settings>) => void
  update: (partial: Partial<Settings>) => void
}

export const useSettings = create<SettingsState>((set) => ({
  ...defaults,
  hydrate: (partial) => set(partial),
  update: (partial) => set(partial),
}))

export async function loadSettings(adapter: PlatformAdapter) {
  const raw = await adapter.getItem('settings')
  if (raw) useSettings.getState().hydrate(JSON.parse(raw) as Partial<Settings>)
}

export function watchSettings(adapter: PlatformAdapter) {
  return useSettings.subscribe((state) => {
    const { apiBaseUrl, cognitoDomain, cognitoClientId, theme } = state
    void adapter.setItem(
      'settings',
      JSON.stringify({ apiBaseUrl, cognitoDomain, cognitoClientId, theme }),
    )
  })
}
