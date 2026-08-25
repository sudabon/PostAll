export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024
export const MAX_ATTACHMENTS = 10

export const ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'application/pdf',
  'text/plain',
  'text/markdown',
  'application/zip',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
])

export const IMAGE_MIME = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp'])

export type AttachmentCheck =
  | { ok: true }
  | { ok: false; message: string }

export function checkAttachment(file: { type: string; size: number }, currentCount: number): AttachmentCheck {
  if (currentCount >= MAX_ATTACHMENTS) {
    return { ok: false, message: '添付は 1 ポストあたり 10 件までです' }
  }
  if (file.size > MAX_ATTACHMENT_BYTES) {
    return { ok: false, message: 'ファイルサイズは 25 MiB 以下である必要があります' }
  }
  if (!ALLOWED_MIME.has(file.type)) {
    return { ok: false, message: 'このファイル形式は添付できません' }
  }
  return { ok: true }
}

const EXT_MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  pdf: 'application/pdf',
  txt: 'text/plain',
  md: 'text/markdown',
  zip: 'application/zip',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
}

export const ACCEPT_ATTR = [...ALLOWED_MIME].join(',')

export function inferMime(name: string, type: string) {
  if (type && ALLOWED_MIME.has(type)) return type
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  return EXT_MIME[ext] ?? type
}

export function isImageType(contentType: string) {
  return IMAGE_MIME.has(contentType)
}

export function formatBytes(n: number) {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`
  return `${(n / (1024 * 1024)).toFixed(1)} MiB`
}

export async function sha256Hex(data: ArrayBuffer) {
  const buf = await crypto.subtle.digest('SHA-256', data)
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
