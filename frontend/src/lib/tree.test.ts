import { describe, expect, it } from 'vitest'
import { buildForest, descendantIds, flattenVisible } from './tree'

describe('channel tree', () => {
  const channels = [
    { id: 'a', name: 'root', sortKey: 'a', parentId: null, createdAt: '', updatedAt: '' },
    { id: 'b', name: 'child', sortKey: 'a', parentId: 'a', createdAt: '', updatedAt: '' },
    { id: 'c', name: 'other', sortKey: 'b', parentId: null, createdAt: '', updatedAt: '' },
  ]

  it('nests children and keeps sibling order', () => {
    const forest = buildForest(channels)
    expect(forest.map((n) => n.name)).toEqual(['root', 'other'])
    expect(forest[0].children.map((n) => n.name)).toEqual(['child'])
  })

  it('lists descendants and respects collapse', () => {
    const forest = buildForest(channels)
    expect([...descendantIds(forest, 'a')]).toEqual(['b'])
    const collapsed = flattenVisible(forest, new Set())
    expect(collapsed.map((r) => r.node.id)).toEqual(['a', 'c'])
    const expanded = flattenVisible(forest, new Set(['a']))
    expect(expanded.map((r) => r.node.id)).toEqual(['a', 'b', 'c'])
  })
})
