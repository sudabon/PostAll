import { useEffect, useId, useRef, useState } from 'react'
import { useDarkMode } from '@/lib/theme'
import { CodeBlock } from './CodeBlock'

export function MermaidBlock({ source }: { source: string }) {
  const dark = useDarkMode()
  const host = useRef<HTMLDivElement>(null)
  const reactId = useId().replace(/[^a-zA-Z0-9]/g, '')
  const [visible, setVisible] = useState(() => typeof IntersectionObserver === 'undefined')
  const [mode, setMode] = useState<'diagram' | 'source'>('diagram')
  const [svg, setSvg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const el = host.current
    if (!el || visible) return
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setVisible(true)
      },
      { rootMargin: '80px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [visible])

  useEffect(() => {
    if (!visible) return
    let cancelled = false
    void (async () => {
      try {
        const mermaid = (await import('mermaid')).default
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          theme: dark ? 'dark' : 'default',
        })
        const { svg: next } = await mermaid.render(`mmd${reactId}`, source)
        if (!cancelled) {
          setSvg(next)
          setError(null)
        }
      } catch {
        if (!cancelled) {
          setSvg(null)
          setError('図の描画に失敗しました')
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [visible, source, dark, reactId])

  return (
    <div ref={host} className="my-2 rounded-lg border border-border p-2 shadow-sm" data-testid="mermaid-block">
      <div className="mb-1 flex justify-end">
        <button type="button" className="rounded-lg px-2 py-1 text-caption text-muted-foreground hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring" onClick={() => setMode((m) => (m === 'diagram' ? 'source' : 'diagram'))}>
          {mode === 'diagram' ? 'ソースを表示' : '図を表示'}
        </button>
      </div>
      {error || mode === 'source' ? (
        <>
          {error ? <p className="mb-1 text-caption text-destructive">{error}</p> : null}
          <CodeBlock code={source} language="mermaid" />
        </>
      ) : svg ? (
        <div className="overflow-auto [&_svg]:max-w-full" dangerouslySetInnerHTML={{ __html: svg }} />
      ) : (
        <p className="text-caption text-muted-foreground">描画中…</p>
      )}
    </div>
  )
}
