import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { BrowserChrome } from './BrowserChrome'
import { PlatformProvider } from '@/platform'
import { createFakeAdapter } from '@/platform/fake'

describe('BrowserChrome', () => {
  it('hides the settings button when an app menu exists', () => {
    const adapter = createFakeAdapter({ capabilities: { appMenu: true } })
    const { queryByTestId } = render(
      <PlatformProvider adapter={adapter}>
        <BrowserChrome />
      </PlatformProvider>,
    )
    expect(queryByTestId('settings-button')).toBeNull()
  })

  it('shows the settings button when there is no app menu', () => {
    const adapter = createFakeAdapter({ capabilities: { appMenu: false } })
    const { getByTestId } = render(
      <PlatformProvider adapter={adapter}>
        <BrowserChrome />
      </PlatformProvider>,
    )
    expect(getByTestId('settings-button')).toBeTruthy()
  })
})
