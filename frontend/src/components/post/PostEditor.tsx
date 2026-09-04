import { useEffect, useRef } from 'react'
import type { Attachment, Post } from '@/api/client'
import { useAuth } from '@/auth/AuthProvider'
import { Composer } from '@/components/composer/Composer'
import { uploadPickedFile } from '@/lib/upload'
import { useUi } from '@/state/ui'

/**
 * ポストの本文表示と入れ替わるインライン編集フォーム。
 * 入力の実体は新規投稿と同じ Composer なので、書式ツールバー・コードブロック補助・
 * 添付の追加が編集でもそのまま使える。
 */
export function PostEditor({
  post,
  mutationDisabled,
  onSave,
}: {
  post: Post
  mutationDisabled: boolean
  onSave: (body: string, attachmentIds: string[], attachments: Attachment[]) => void | Promise<void>
}) {
  const { api } = useAuth()
  const host = useRef<HTMLDivElement>(null)
  const failedEdit = useUi((state) => state.failedEdits[post.id])

  useEffect(() => {
    const el = host.current
    if (!el) return
    const reveal = () => el.scrollIntoView({ block: 'nearest' })
    const frame = requestAnimationFrame(reveal)
    // 狭幅ではソフトキーボードの出現で可視領域が縮み、開いた直後に合わせた位置が
    // キーボードの下へ潜る。visualViewport の変化に合わせてもう一度引き上げる。
    const viewport = window.visualViewport
    viewport?.addEventListener('resize', reveal)
    return () => {
      cancelAnimationFrame(frame)
      viewport?.removeEventListener('resize', reveal)
    }
  }, [])


  return (
    <div ref={host} data-testid={`post-editor-${post.id}`}>
      <Composer
        storageKey={`edit:${post.id}`}
        persistDraft={false}
        autoFocus
        initialBody={failedEdit?.body ?? post.body}
        initialAttachments={failedEdit?.attachments ?? post.attachments ?? []}
        initialError={failedEdit?.error}
        submitLabel="保存"
        placeholder="本文を入力"
        mutationDisabled={mutationDisabled}
        uploadFile={(file, onProgress) => uploadPickedFile(api, file, onProgress)}
        resolveAttachmentUrl={(id) => api.getDownloadUrl(id).then((r) => r.url)}
        onCancel={() => {
          const ui = useUi.getState()
          ui.clearFailedEdit(post.id)
          ui.setEditingPost(null)
        }}
        onSubmit={onSave}
      />
    </div>
  )
}
