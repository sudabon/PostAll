export type ExcerptPart = {
  text: string
  match: boolean
}

export type Excerpt = {
  parts: ExcerptPart[]
  clippedStart: boolean
  clippedEnd: boolean
}

export function buildExcerpt(body: string, query: string, radius = 48): Excerpt {
  const source = Array.from(body)
  const needle = Array.from(query)
  if (needle.length === 0) {
    return { parts: [{ text: body, match: false }], clippedStart: false, clippedEnd: false }
  }

  const matchesAt = (index: number) =>
    source.slice(index, index + needle.length).join('').toLocaleLowerCase() === query.toLocaleLowerCase()
  let first = -1
  for (let i = 0; i <= source.length - needle.length; i += 1) {
    if (matchesAt(i)) {
      first = i
      break
    }
  }
  if (first < 0) {
    const end = Math.min(source.length, Math.max(0, radius * 2))
    return {
      parts: [{ text: source.slice(0, end).join(''), match: false }],
      clippedStart: false,
      clippedEnd: end < source.length,
    }
  }

  const start = Math.max(0, first - radius)
  const end = Math.min(source.length, first + needle.length + radius)
  const parts: ExcerptPart[] = []
  let plainStart = start
  let i = start
  while (i < end) {
    if (i + needle.length <= end && matchesAt(i)) {
      if (plainStart < i) {
        parts.push({ text: source.slice(plainStart, i).join(''), match: false })
      }
      parts.push({ text: source.slice(i, i + needle.length).join(''), match: true })
      i += needle.length
      plainStart = i
      continue
    }
    i += 1
  }
  if (plainStart < end) {
    parts.push({ text: source.slice(plainStart, end).join(''), match: false })
  }

  return {
    parts,
    clippedStart: start > 0,
    clippedEnd: end < source.length,
  }
}
