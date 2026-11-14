import { KeyRound, Lock } from 'lucide-react'
import type { Post } from '@/api/client'
import { AttachmentGallery } from '@/components/attachments/AttachmentGallery'
import { MarkdownBody } from '@/components/markdown/MarkdownBody'
import { Button } from '@/components/ui/button'
import { useDecryptedBody } from '@/encryption/useDecryptedBody'
import { useEncryptionOptional } from '@/encryption/encryption-context'

export function PostBody({ post }: { post: Post }) {
  const decrypted = useDecryptedBody(post)
  const attachments = post.attachments ?? []
  if (post.encrypted) {
    if (decrypted.status === 'locked') return <LockedPostBody />
    if (decrypted.status === 'undecryptable') return <UndecryptablePostBody />
    if (decrypted.status === 'pending') {
      return <p className="text-caption text-muted-foreground">復号しています…</p>
    }
    return <MarkdownBody markdown={decrypted.text} />
  }
  return (
    <div>
      {post.body.trim() ? <MarkdownBody markdown={post.body} /> : null}
      <AttachmentGallery items={attachments} />
    </div>
  )
}

export function LockedPostBody() {
  const encryption = useEncryptionOptional()
  return (
    <div className="flex flex-wrap items-center gap-2 text-body text-muted-foreground" data-testid="locked-post">
      <Lock className="size-4" aria-hidden="true" />
      <span>ロック中</span>
      <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-caption" data-testid="unlock-post" onClick={() => void encryption?.requestUnlock()}>
        解錠する
      </Button>
    </div>
  )
}

export function UndecryptablePostBody() {
  return (
    <p className="text-body text-muted-foreground" data-testid="undecryptable-post">
      <KeyRound className="mr-1 inline size-4" aria-hidden="true" />
      復号できません
    </p>
  )
}
