import { useEffect, useState } from 'react'
import type { Post } from '@/api/client'
import { decryptPost } from '@/crypto/envelope'
import type { DecryptedBody } from './encryption-context'
import { useEncryptionOptional } from './encryption-context'

/** 暗号化チャネルの本文を、解錠中だけ復号して返す。結果は鍵の世代が変わるまで使い回す。 */
export function useDecryptedBody(post: Pick<Post, 'body' | 'encrypted' | 'ciphertext'>): DecryptedBody {
  const encryption = useEncryptionOptional()
  const ciphertext = post.ciphertext ?? ''
  const unlocked = Boolean(
    post.encrypted && encryption?.phase === 'unlocked' && ciphertext && encryption.dataKey && encryption.keyId,
  )
  // 復号済みなら、最初の描画から本文を出す（編集フォームの初期値や、再マウント時のちらつきのため）。
  const cached = unlocked ? encryption!.cacheSlot(ciphertext) : undefined
  // 鍵の世代が変わったら、前の世代で復号した結果は使わない。
  const slot = `${encryption?.generation ?? 0}:${ciphertext}`
  const [resolved, setResolved] = useState<{ slot: string; text: string | null } | null>(null)

  useEffect(() => {
    if (!unlocked || cached !== undefined || !encryption?.dataKey || !encryption.keyId) return
    let cancelled = false
    const { dataKey, keyId } = encryption
    void decryptPost(dataKey, keyId, ciphertext).then(
      (plain) => {
        encryption.rememberDecryption(ciphertext, plain)
        if (!cancelled) setResolved({ slot, text: plain })
      },
      () => {
        encryption.rememberDecryption(ciphertext, null)
        if (!cancelled) setResolved({ slot, text: null })
      },
    )
    return () => {
      cancelled = true
    }
  }, [cached, ciphertext, encryption, slot, unlocked])

  if (!post.encrypted) return { status: 'plain', text: post.body }
  if (!unlocked) return { status: 'locked' }
  const text = cached !== undefined ? cached : resolved?.slot === slot ? resolved.text : undefined
  if (text === undefined) return { status: 'pending' }
  if (text === null) return { status: 'undecryptable' }
  return { status: 'plain', text }
}
