import { describe, expect, it } from 'vitest'
import { createFakeAdapter } from './fake'

describe('fake adapter', () => {
  it('persists items and secrets', async () => {
    const adapter = createFakeAdapter()
    await adapter.setItem('k', 'v')
    await adapter.setSecret('s', 'tok')
    expect(await adapter.getItem('k')).toBe('v')
    expect(await adapter.getSecret('s')).toBe('tok')
    await adapter.deleteSecret('s')
    expect(await adapter.getSecret('s')).toBeNull()
  })

  it('reports capabilities', () => {
    const adapter = createFakeAdapter({ capabilities: { globalShortcuts: false } })
    expect(adapter.has('appMenu')).toBe(true)
    expect(adapter.has('globalShortcuts')).toBe(false)
  })

  it('returns seeded files and ingests File objects', async () => {
    const data = new Uint8Array([1, 2, 3]).buffer
    const adapter = createFakeAdapter({ files: [{ name: 'a.png', type: 'image/png', data }] })
    expect(await adapter.pickFiles()).toEqual([{ name: 'a.png', type: 'image/png', data }])
    const file = new File(['hi'], 'b.txt', { type: 'text/plain' })
    const ingested = await adapter.ingestFiles([file])
    expect(ingested[0]?.name).toBe('b.txt')
    expect(ingested[0]?.type).toBe('text/plain')
  })
})
