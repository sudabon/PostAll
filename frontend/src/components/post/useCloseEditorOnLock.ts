import { useEffect } from 'react'
import { useUi } from '@/state/ui'

/**
 * ロック中の暗号化チャネルのポストでは、編集フォームを閉じ、保存に失敗した平文も捨てる。
 * ロックで編集フォームは描画されなくなるので、ポストの行の側から呼ぶ。
 */
export function useCloseEditorOnLock(postId: string, locked: boolean) {
  // ロックの後に保存の失敗が届いて、編集フォームが開き直ることもある。
  const open = useUi((state) => state.editingPostId === postId || postId in state.failedEdits)
  useEffect(() => {
    if (!locked || !open) return
    const ui = useUi.getState()
    ui.clearFailedEdit(postId)
    if (ui.editingPostId === postId) ui.setEditingPost(null)
  }, [locked, open, postId])
}
