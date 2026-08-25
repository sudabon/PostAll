import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { Emoji } from '@/api/client'
import { useAuth } from '@/auth/AuthProvider'
import { cn } from '@/lib/utils'

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
  const [source] = useState(() => URL.createObjectURL(blob))
  const [failed, setFailed] = useState(false)

  useEffect(() => () => URL.revokeObjectURL(source), [source])

  if (failed) {
    return (
      <span
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
      src={source}
      alt={decorative ? '' : `:${shortcode}:`}
      className={cn('inline-block object-contain', className)}
      onError={() => setFailed(true)}
    />
  )
}
