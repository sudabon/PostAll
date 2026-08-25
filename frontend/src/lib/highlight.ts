const langs = [
  'javascript',
  'typescript',
  'tsx',
  'jsx',
  'python',
  'go',
  'rust',
  'json',
  'yaml',
  'bash',
  'shell',
  'sql',
  'html',
  'css',
  'markdown',
  'java',
  'c',
  'cpp',
] as const

type Lang = (typeof langs)[number]

function normalizeLang(lang: string): Lang | null {
  const key = lang.trim().toLowerCase()
  if (key === 'js') return 'javascript'
  if (key === 'ts') return 'typescript'
  if (key === 'yml') return 'yaml'
  if (key === 'sh') return 'bash'
  return (langs as readonly string[]).includes(key) ? (key as Lang) : null
}

export async function highlightCode(code: string, language: string | undefined, dark: boolean): Promise<string | null> {
  if (!language) return null
  const lang = normalizeLang(language)
  if (!lang) return null
  try {
    const { codeToHtml } = await import('shiki')
    return await codeToHtml(code, {
      lang,
      theme: dark ? 'github-dark' : 'github-light',
    })
  } catch {
    return null
  }
}
