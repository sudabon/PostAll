import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildCspPolicy, cspConnectSources } from './csp.ts'

function directives(policy: string): Map<string, string[]> {
  return new Map(
    policy.split(';').map((part) => {
      const [name, ...values] = part.trim().split(/\s+/)
      return [name!, values]
    }),
  )
}

describe('buildCspPolicy', () => {
  const production = directives(buildCspPolicy({ supabaseUrl: 'https://abcd1234.supabase.co', apiBaseUrl: '' }))

  it('limits script-src to self and WASM compilation', () => {
    expect(production.get('script-src')).toEqual(["'self'", "'wasm-unsafe-eval'"])
    expect(production.get('script-src')).not.toContain("'unsafe-inline'")
    expect(production.get('script-src')).not.toContain("'unsafe-eval'")
  })

  it('forbids plugins and <base> rewriting', () => {
    expect(production.get('object-src')).toEqual(["'none'"])
    expect(production.get('base-uri')).toEqual(["'self'"])
    expect(production.get('default-src')).toEqual(["'self'"])
    expect(production.get('form-action')).toEqual(["'self'"])
  })

  it('derives https, wss and storage origins from the Supabase project URL', () => {
    expect(production.get('connect-src')).toEqual([
      "'self'",
      'https://abcd1234.supabase.co',
      'wss://abcd1234.supabase.co',
      'https://abcd1234.storage.supabase.co',
    ])
    expect(cspConnectSources({ supabaseUrl: 'https://abcd1234.supabase.co/' })).toContain('wss://abcd1234.supabase.co')
  })

  it('uses http and ws for a local Supabase stack and allows its images', () => {
    const local = directives(buildCspPolicy({ supabaseUrl: 'http://127.0.0.1:54321' }))
    expect(local.get('connect-src')).toEqual(["'self'", 'http://127.0.0.1:54321', 'ws://127.0.0.1:54321'])
    expect(local.get('img-src')).toContain('http://127.0.0.1:54321')
  })

  it('omits Supabase origins when VITE_SUPABASE_URL is unset or blank', () => {
    for (const supabaseUrl of [undefined, '', '   ']) {
      expect(cspConnectSources({ supabaseUrl })).toEqual(["'self'"])
    }
  })

  it('does not add a same-origin API, but adds a cross-origin one', () => {
    for (const apiBaseUrl of [undefined, '', '/', '/api']) {
      expect(cspConnectSources({ apiBaseUrl })).toEqual(["'self'"])
    }
    expect(cspConnectSources({ apiBaseUrl: 'http://127.0.0.1:8080/' })).toEqual(["'self'", 'http://127.0.0.1:8080'])
    expect(
      cspConnectSources({ supabaseUrl: 'http://127.0.0.1:54321', apiBaseUrl: 'http://127.0.0.1:54321' }),
    ).toEqual(["'self'", 'http://127.0.0.1:54321', 'ws://127.0.0.1:54321'])
  })

  it('keeps images and Mermaid styles working', () => {
    expect(production.get('img-src')).toEqual(["'self'", 'data:', 'blob:', 'https:'])
    expect(production.get('style-src')).toEqual(["'self'", "'unsafe-inline'"])
  })

  it('fails the build on a malformed Supabase URL', () => {
    expect(() => buildCspPolicy({ supabaseUrl: 'abcd1234.supabase.co' })).toThrow(/VITE_SUPABASE_URL/)
  })
})

describe('vercel.json', () => {
  it("still sends frame-ancestors 'none' for every path", () => {
    const config = JSON.parse(
      readFileSync(path.resolve(import.meta.dirname, '../../vercel.json'), 'utf8'),
    ) as { headers: { source: string; headers: { key: string; value: string }[] }[] }
    const all = config.headers.find((entry) => entry.source === '/(.*)')
    const csp = all?.headers.find((header) => header.key.toLowerCase() === 'content-security-policy')
    expect(csp?.value).toMatch(/frame-ancestors 'none'/)
  })
})
