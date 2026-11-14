import { useEffect, useRef } from 'react'
import { useDecryptedBody } from '@/encryption/useDecryptedBody'
import type { Attachment, Post } from '@/api/client'
import { useAuth } from '@/auth/AuthProvider'
import { usePlatform } from '@/platform'
import { Composer } from '@/components/composer/Composer'
import { UndecryptablePostBody } from '@/components/post/PostBody'
import { postChangedElsewhereMessage, staleEditDiscardedMessage } from '@/lib/submit-failure'
import { uploadPickedFile } from '@/lib/upload'
import { useUi } from '@/state/ui'

/**
 * ポストの本文表示と入れ替わるインライン編集フォーム。
 * 入力の実体は新規投稿と同じ Composer なので、書式ツールバー・コードブロック補助・
 * 添付の追加が編集でもそのまま使える。
 * 暗号化チャネルのポストは、復号した本文で開き、添付は扱わない（保存時の暗号化は usePostMutations）。
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
  const platform = usePlatform()
  const decrypted = useDecryptedBody(post)
  const host = useRef<HTMLDivElement>(null)
  const failedEdit = useUi((state) => state.failedEdits[post.id])
  const autoOpened = useUi((state) => state.autoOpenedEditPostId === post.id)
  // 保持入力を書き留めた時点より後にポストが更新されていたら、その入力は復元しない。
  const stale = Boolean(
    failedEdit && !failedEdit.discarded && failedEdit.postUpdatedAt !== post.updatedAt,
  )
  const staleOnMount = useRef(stale)
  const restored = failedEdit && !failedEdit.discarded && !stale ? failedEdit : undefined

  useEffect(() => {
    if (!stale) return
    // 破棄した事実は再マウント後にも伝えたいので、エントリを消さず discarded を立てる。
    // 開く前から古かった入力は復元しないので「破棄した」と伝える。開いている最中に
    // 古くなった場合は画面の入力を勝手に捨てず、上書きになる旨だけを警告する。
    useUi.getState().setFailedEdit(post.id, {
      ...failedEdit!,
      discarded: true,
      error: staleOnMount.current ? staleEditDiscardedMessage : postChangedElsewhereMessage,
    })
  }, [stale, post.id, failedEdit])

  useEffect(() => {
    const el = host.current
    if (!el) return
    const reveal = () => el.scrollIntoView({ block: 'nearest' })
    // 失敗による自動再オープンはユーザー操作を起点としないので、勝手にスクロールしない。
    const frame = autoOpened ? null : requestAnimationFrame(reveal)
    // 狭幅ではソフトキーボードの出現で可視領域が縮み、開いた直後に合わせた位置が
    // キーボードの下へ潜る。visualViewport の変化に合わせてもう一度引き上げる。
    // こちらは利用者がフォームに触れた結果なので、自動再オープンでも効かせる。
    const viewport = window.visualViewport
    viewport?.addEventListener('resize', reveal)
    return () => {
      if (frame !== null) cancelAnimationFrame(frame)
      viewport?.removeEventListener('resize', reveal)
    }
  }, [autoOpened])

  const onCancel = () => {
    const ui = useUi.getState()
    ui.clearFailedEdit(post.id)
    ui.setEditingPost(null)
  }

  // 暗号化チャネルのポストは、復号できてから入力欄を作る（初期値は最初の描画で決まる）。
  // ロック中は行の側が編集フォームを閉じる（useCloseEditorOnLock）。
  if (post.encrypted && decrypted.status !== 'plain') {
    return (
      <div ref={host} data-testid={`post-editor-${post.id}`}>
        {decrypted.status === 'undecryptable' ? (
          <UndecryptablePostBody />
        ) : decrypted.status === 'pending' ? (
          <p className="text-caption text-muted-foreground">復号しています…</p>
        ) : null}
      </div>
    )
  }

  return (
    <div ref={host} data-testid={`post-editor-${post.id}`}>
      <Composer
        storageKey={`edit:${post.id}`}
        persistDraft={false}
        encrypted={post.encrypted}
        autoFocus
        suppressAutoFocus={autoOpened}
        initialBody={restored?.body ?? (decrypted.status === 'plain' ? decrypted.text : post.body)}
        initialAttachments={post.encrypted ? [] : restored?.attachments ?? post.attachments ?? []}
        initialError={failedEdit?.error}
        submitLabel="保存"
        placeholder="本文を入力"
        mutationDisabled={mutationDisabled}
        uploadFile={post.encrypted ? undefined : (file, onProgress) => uploadPickedFile(api, file, onProgress, platform.putBytes)}
        resolveAttachmentUrl={(id) => api.getDownloadUrl(id).then((r) => r.url)}
        onCancel={onCancel}
        onSubmit={onSave}
      />
    </div>
  )
}
