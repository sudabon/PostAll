import { useEffect, useRef, useState } from 'react'
import { useUi } from '@/state/ui'
import { useChannels } from './useChannels'

export function useRestoreSelectedChannel() {
  const [restoredChannelId] = useState(() => useUi.getState().selectedChannelId)
  const checked = useRef(false)
  const { data, isSuccess, isFetching } = useChannels()

  useEffect(() => {
    if (checked.current || !isSuccess || isFetching) return
    checked.current = true
    const ui = useUi.getState()
    // 取得を待つ間に選び直したチャネルや、起動後の選択には介入しない。
    if (restoredChannelId !== null && ui.selectedChannelId === restoredChannelId
      && !data.some((channel) => channel.id === restoredChannelId)) {
      ui.clearRestoredChannel()
    }
  }, [data, isSuccess, isFetching, restoredChannelId])
}
