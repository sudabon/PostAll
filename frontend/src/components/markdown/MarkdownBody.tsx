import { Children, isValidElement, type ReactNode } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeRaw from 'rehype-raw'
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize'
import { usePlatform } from '@/platform'
import { CodeBlock } from './CodeBlock'
import { MermaidBlock } from './MermaidBlock'

const schema = {
  ...defaultSchema,
  // 書式ツールバーの「下線」が挿入する <u> のみ生 HTML を許可する。
  // rehype-raw の後段でこの許可リストを適用するため、他のタグ・属性は従来どおり除去される。
  tagNames: [...(defaultSchema.tagNames ?? []), 'u'],
  protocols: {
    ...defaultSchema.protocols,
    href: ['http', 'https', 'mailto'],
  },
  attributes: {
    ...defaultSchema.attributes,
    code: [...(defaultSchema.attributes?.code ?? []), ['className']],
    pre: [...(defaultSchema.attributes?.pre ?? []), ['className']],
  },
}

function languageOf(className?: string) {
  return /language-([\w+-]+)/.exec(className ?? '')?.[1]
}

function textOf(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children)
  return ''
}

export function MarkdownBody({ markdown }: { markdown: string }) {
  const platform = usePlatform()
  return (
    <div className="markdown-body text-body" data-testid="markdown-body">
      <Markdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw, [rehypeSanitize, schema]]}
        components={{
          a: ({ href, children }) => {
            if (!href || !/^(https?:|mailto:)/i.test(href)) {
              return <span>{children}</span>
            }
            return (
              <a
                href={href}
                onClick={(e) => {
                  e.preventDefault()
                  void platform.openExternal(href)
                }}
              >
                {children}
              </a>
            )
          },
          pre: ({ children }) => {
            const child = Children.toArray(children)[0]
            if (isValidElement<{ className?: string; children?: ReactNode }>(child)) {
              const lang = languageOf(child.props.className)
              const code = textOf(child.props.children).replace(/\n$/, '')
              if (lang === 'mermaid') return <MermaidBlock source={code} />
              return <CodeBlock code={code} language={lang} />
            }
            return <pre>{children}</pre>
          },
          code: ({ className, children }) => {
            if (className || String(children).includes('\n')) {
              return <code className={className}>{children}</code>
            }
            return <code className="rounded-sm bg-muted px-1 py-0.5 font-mono text-caption">{children}</code>
          },
          table: ({ children }) => (
            <div className="my-2 overflow-x-auto">
              <table>{children}</table>
            </div>
          ),
        }}
      >
        {markdown}
      </Markdown>
    </div>
  )
}
