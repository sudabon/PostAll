import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { Emoji } from '@/api/client'
import { useAuth } from '@/auth/AuthProvider'
import { cn } from '@/lib/utils'

// blob ごとのオブジェクト URL を 1 つだけ持つ。
//
// URL を useState の初期化子で作り、effect の cleanup で revoke する形にすると、
// StrictMode が mount 時に effect を setup → cleanup → setup で回すため、
// マウントしたままの img が revoke 済みの URL を指し続ける（開発ビルドで
// すべての絵文字画像が読めなくなる）。逆に revoke をやめただけでは、ピッカーの
// 開閉ごとの再マウントで同じ blob の URL が増え続ける。
//
// blob に紐づけて 1 つだけ作れば、二重描画でも再マウントでも同じ URL を返せる。
// 残る URL は「描画されたことのある (ショートコード, チェックサム) の数」で
// 上限されるので、カタログの件数に収まる。
const objectUrls = new WeakMap<Blob, string>()

function objectUrlFor(blob: Blob): string {
  const existing = objectUrls.get(blob)
  if (existing) return existing
  const created = URL.createObjectURL(blob)
  objectUrls.set(blob, created)
  return created
}

export function EmojiImage({
  emoji,
  className,
  fallbackClassName,
  decorative = false,
}: {
  emoji: Emoji
  className?: string
  fallbackClassName?: string
  decorative?: boolean
}) {
  const { api, signedIn } = useAuth()
  const image = useQuery({
    queryKey: ['emoji-image', emoji.shortcode, emoji.checksum],
    enabled: signedIn,
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
    queryFn: () => api.getEmojiImage(emoji.shortcode),
  })

  if (!image.data || image.isError) {
    return (
      <span
        data-testid="emoji-fallback"
        className={cn(
          'inline-flex max-w-24 items-center justify-center truncate whitespace-nowrap text-[10px] leading-none',
          fallbackClassName,
        )}
        title={`:${emoji.shortcode}:`}
        aria-hidden={decorative || undefined}
      >
        :{emoji.shortcode}:
      </span>
    )
  }

  return (
    <BlobImage
      key={`${emoji.shortcode}:${emoji.checksum}`}
      blob={image.data}
      shortcode={emoji.shortcode}
      className={className}
      fallbackClassName={fallbackClassName}
      decorative={decorative}
    />
  )
}

function BlobImage({
  blob,
  shortcode,
  className,
  fallbackClassName,
  decorative,
}: {
  blob: Blob
  shortcode: string
  className?: string
  fallbackClassName?: string
  decorative: boolean
}) {
  const [failed, setFailed] = useState(false)
  const source = objectUrlFor(blob)

  if (failed) {
    return (
      <span
        data-testid="emoji-fallback"
        className={cn(
          'inline-flex max-w-24 items-center justify-center truncate whitespace-nowrap text-[10px] leading-none',
          fallbackClassName,
        )}
        title={`:${shortcode}:`}
        aria-hidden={decorative || undefined}
      >
        :{shortcode}:
      </span>
    )
  }

  return (
    <img
      data-testid="emoji-image"
      src={source}
      alt={decorative ? '' : `:${shortcode}:`}
      className={cn('inline-block object-contain', className)}
      onError={() => setFailed(true)}
    />
  )
}
