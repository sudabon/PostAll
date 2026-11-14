import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Post } from '@/api/client'
import { decryptPost, encryptPost } from '@/crypto/envelope'
import { deriveDataKey, generateMasterKey, wrapWithPassphrase, wrapWithRecoveryKey } from '@/crypto/keys'
import { generateRecoveryKey } from '@/crypto/recovery-key'
import { EncryptionProvider } from '@/encryption/encryption-provider'
import { PlatformProvider, createFakeAdapter, createMemoryKeyStore } from '@/platform'
import { PostBody } from './PostBody'

const auth = vi.hoisted(() => ({
  signedIn: true,
  api: { getEncryptionKeyring: vi.fn(), createEncryptionKeyring: vi.fn(), replaceEncryptionKeyWrap: vi.fn() },
}))

vi.mock('@/auth/auth-context', () => ({
  useAuth: () => auth,
}))

const PASSPHRASE = 'correct horse battery staple'
const KEY_ID = '0b6c5c1e-8d2a-4f7e-9c3b-1a2b3c4d5e6f'

function post(overrides: Partial<Post>): Post {
  return {
    id: '22222222-2222-2222-2222-222222222222',
    channelId: '11111111-1111-1111-1111-111111111111',
    authorId: '44444444-4444-4444-4444-444444444444',
    body: '',
    encrypted: true,
    createdAt: '2026-11-13T00:00:00Z',
    updatedAt: '2026-11-13T00:00:00Z',
    deleted: false,
    replyCount: 0,
    attachments: [],
    reactions: [],
    ...overrides,
  }
}

async function unlockedStore(plaintext: string) {
  const master = generateMasterKey()
  const recovery = generateRecoveryKey()
  const dataKey = await deriveDataKey(master, KEY_ID)
  const ciphertext = await encryptPost(dataKey, KEY_ID, plaintext)
  const store = createMemoryKeyStore()
  await store.save(KEY_ID, master)
  const keyring = {
    keyId: KEY_ID,
    passphraseWrap: await wrapWithPassphrase(master, PASSPHRASE, KEY_ID, { iterations: 1_000 }),
    recoveryWrap: await wrapWithRecoveryKey(master, recovery, KEY_ID),
    createdAt: '2026-11-13T00:00:00Z',
    updatedAt: '2026-11-13T00:00:00Z',
  }
  master.fill(0)
  recovery.fill(0)
  return { store, keyring, ciphertext, dataKey }
}

function renderBody(node: Post, store = createMemoryKeyStore()) {
  return render(
    <PlatformProvider adapter={createFakeAdapter({ encryptionKeyStore: store })}>
      <EncryptionProvider>
        <PostBody post={node} />
      </EncryptionProvider>
    </PlatformProvider>,
  )
}

beforeEach(() => {
  auth.api.getEncryptionKeyring.mockReset()
})

describe('PostBody', () => {
  it('renders markdown after unlocking a ciphertext', async () => {
    const { store, keyring, ciphertext } = await unlockedStore('**太字** のメモ')
    auth.api.getEncryptionKeyring.mockResolvedValue(keyring)
    renderBody(post({ ciphertext }), store)
    expect(await screen.findByTestId('markdown-body')).toHaveTextContent('太字')
    expect(screen.queryByText(ciphertext)).toBeNull()
  })

  it('shows a locked post with an unlock action and no body', async () => {
    const { keyring, ciphertext } = await unlockedStore('見えてはいけない')
    auth.api.getEncryptionKeyring.mockResolvedValue(keyring)
    renderBody(post({ ciphertext }))
    expect(await screen.findByTestId('locked-post')).toHaveTextContent('ロック中')
    expect(screen.getByTestId('unlock-post')).toBeTruthy()
    expect(screen.queryByText('見えてはいけない')).toBeNull()
    expect(screen.queryByText(ciphertext)).toBeNull()
  })

  it('shows an undecryptable post without any plaintext', async () => {
    const { store, keyring, ciphertext, dataKey } = await unlockedStore('正しい本文')
    auth.api.getEncryptionKeyring.mockResolvedValue(keyring)
    const tampered = `${ciphertext.slice(0, -2)}aa`
    expect(tampered).not.toBe(ciphertext)
    await expect(decryptPost(dataKey, KEY_ID, tampered)).rejects.toThrow()
    renderBody(post({ ciphertext: tampered }), store)
    expect(await screen.findByTestId('undecryptable-post')).toHaveTextContent('復号できません')
    await waitFor(() => expect(screen.queryByText('正しい本文')).toBeNull())
    expect(screen.queryByText(tampered)).toBeNull()
  })
})
