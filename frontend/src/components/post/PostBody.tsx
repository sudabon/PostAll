import type { Post } from '@/api/client'
import { AttachmentGallery } from '@/components/attachments/AttachmentGallery'
import { MarkdownBody } from '@/components/markdown/MarkdownBody'

export function PostBody({ post }: { post: Post }) {
  const attachments = post.attachments ?? []
  return (
    <div>
      {post.body.trim() ? <MarkdownBody markdown={post.body} /> : null}
      <AttachmentGallery items={attachments} />
    </div>
  )
}
