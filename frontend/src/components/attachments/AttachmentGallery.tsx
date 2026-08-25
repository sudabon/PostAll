import { useEffect, useState } from 'react'
import type { Attachment } from '@/api/client'
import { useAuth } from '@/auth/AuthProvider'
import { usePlatform } from '@/platform'
import { formatBytes, isImageType } from '@/lib/attachments'

export function AttachmentGallery({ items }: { items: Attachment[] }) {
  const images = items.filter((a) => isImageType(a.contentType))
  const files = items.filter((a) => !isImageType(a.contentType))
  if (items.length === 0) return null
  return (
    <div className="mt-2 space-y-2" data-testid="attachment-gallery">
      {images.length > 0 ? (
        <div className={images.length === 1 ? 'max-w-md' : 'grid grid-cols-2 gap-2'}>
          {images.map((img) => (
            <ImageThumb key={img.id} item={img} />
          ))}
        </div>
      ) : null}
      {files.map((file) => (
        <FileCard key={file.id} item={file} />
      ))}
    </div>
  )
}

function ImageThumb({ item }: { item: Attachment }) {
  const url = useSignedUrl(item.id)
  const [open, setOpen] = useState(false)
  const [failed, setFailed] = useState(false)

  if (failed || url === 'error') {
    return (
      <div className="flex h-32 items-center justify-center rounded-md bg-muted text-xs text-muted-foreground">
        画像を取得できません
      </div>
    )
  }
  if (!url) {
    return <div className="h-32 animate-pulse rounded-md bg-muted" />
  }
  return (
    <>
      <button type="button" className="block overflow-hidden rounded-md" onClick={() => setOpen(true)}>
        <img src={url} alt={item.fileName} className="max-h-48 w-full object-contain" onError={() => setFailed(true)} />
      </button>
      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6"
          role="dialog"
          aria-label="画像プレビュー"
          onClick={() => setOpen(false)}
        >
          <img src={url} alt={item.fileName} className="max-h-full max-w-full object-contain" onClick={(e) => e.stopPropagation()} />
          <button type="button" className="absolute right-4 top-4 text-sm text-white" onClick={() => setOpen(false)}>
            閉じる
          </button>
        </div>
      ) : null}
    </>
  )
}

function FileCard({ item }: { item: Attachment }) {
  const { api } = useAuth()
  const platform = usePlatform()
  const [busy, setBusy] = useState(false)

  const download = async () => {
    setBusy(true)
    try {
      const { url } = await api.getDownloadUrl(item.id)
      const res = await fetch(url)
      if (!res.ok) throw new Error('download')
      const buf = new Uint8Array(await res.arrayBuffer())
      const saved = await platform.saveFile(item.fileName, buf, item.contentType)
      if (!saved) await platform.openExternal(url)
    } catch {
      try {
        const { url } = await api.getDownloadUrl(item.id)
        await platform.openExternal(url)
      } catch {
        // keep UI intact
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm">
      <div className="min-w-0">
        <p className="truncate font-medium">{item.fileName}</p>
        <p className="text-xs text-muted-foreground">
          {item.contentType} · {formatBytes(item.sizeBytes)}
        </p>
      </div>
      <button type="button" className="shrink-0 text-xs text-primary" disabled={busy} onClick={() => void download()}>
        {busy ? '取得中…' : 'ダウンロード'}
      </button>
    </div>
  )
}

function useSignedUrl(id: string) {
  const { api } = useAuth()
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    void api
      .getDownloadUrl(id)
      .then((r) => {
        if (!cancelled) setUrl(r.url)
      })
      .catch(() => {
        if (!cancelled) setUrl('error')
      })
    return () => {
      cancelled = true
    }
  }, [api, id])
  return url
}
