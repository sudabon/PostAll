import type { Channel } from '@/api/client'

export type ChannelNode = Channel & { children: ChannelNode[] }

export function buildForest(channels: Channel[]): ChannelNode[] {
  const byId = new Map<string, ChannelNode>()
  for (const ch of channels) byId.set(ch.id, { ...ch, children: [] })
  const roots: ChannelNode[] = []
  const sorted = [...channels].sort((a, b) => a.sortKey.localeCompare(b.sortKey) || a.id.localeCompare(b.id))
  for (const ch of sorted) {
    const node = byId.get(ch.id)!
    if (ch.parentId && byId.has(ch.parentId)) byId.get(ch.parentId)!.children.push(node)
    else roots.push(node)
  }
  return roots
}

export function descendantIds(nodes: ChannelNode[], id: string): Set<string> {
  const map = new Map<string, ChannelNode>()
  const walk = (list: ChannelNode[]) => {
    for (const n of list) {
      map.set(n.id, n)
      walk(n.children)
    }
  }
  walk(nodes)
  const out = new Set<string>()
  const add = (nid: string) => {
    const n = map.get(nid)
    if (!n) return
    for (const c of n.children) {
      out.add(c.id)
      add(c.id)
    }
  }
  add(id)
  return out
}

export function flattenVisible(nodes: ChannelNode[], expanded: Set<string>, depth = 0): { node: ChannelNode; depth: number }[] {
  const out: { node: ChannelNode; depth: number }[] = []
  for (const node of nodes) {
    out.push({ node, depth })
    if (expanded.has(node.id) && node.children.length > 0) {
      out.push(...flattenVisible(node.children, expanded, depth + 1))
    }
  }
  return out
}

export function visibleSequence(nodes: ChannelNode[], expanded: Set<string>): ChannelNode[] {
  return flattenVisible(nodes, expanded).map((x) => x.node)
}
