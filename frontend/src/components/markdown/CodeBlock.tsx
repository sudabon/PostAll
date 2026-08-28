import { useEffect, useState } from 'react'
import { highlightCode } from '@/lib/highlight'
import { useDarkMode } from '@/lib/theme'

export function CodeBlock({ code, language }: { code: string; language?: string }) {
  const dark = useDarkMode()
  const [html, setHtml] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let cancelled = false
    void highlightCode(code, language, dark).then((next) => {
      if (!cancelled) setHtml(next)
    })
    return () => {
      cancelled = true
    }
  }, [code, language, dark])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div className="group relative my-2" data-testid="code-block">
      <button
        type="button"
        className="material-thin absolute right-2 top-2 z-10 rounded-lg px-2 py-0.5 text-caption opacity-0 shadow-sm ring-1 ring-border group-focus-within:opacity-100 group-hover:opacity-100"
        onClick={() => void copy()}
      >
        {copied ? 'コピーしました' : 'コピー'}
      </button>
      <div className="overflow-x-auto rounded-lg border border-border text-caption shadow-sm">
        {html ? (
          <div className="shiki-wrap" dangerouslySetInnerHTML={{ __html: html }} />
        ) : (
          <pre className="m-0 p-3 font-mono leading-relaxed">
            <code>{code}</code>
          </pre>
        )}
      </div>
    </div>
  )
}
