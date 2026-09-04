import type { Page } from '@playwright/test'
import { installApiMock, expect, test } from './mock'
import {
  animatedGif,
  oversizedPng,
  smallPng,
  unsupportedFormat,
  unusableNamePng,
} from './fixtures/stamps'
import { StampPicker } from './pages/StampPicker'

const CHANGE = '@add-stamp-upload-in-picker'
const POST = 'スタンプ登録のためのメモ'

type Mock = Awaited<ReturnType<typeof installApiMock>>

/** ピッカーを開いた状態まで進める。fixture 名: mock:signed-in-with-emojis */
async function openPicker(page: Page, mock: Mock): Promise<StampPicker> {
  mock.seedChannel('inbox', [POST])
  await page.goto('/')
  await page.getByTestId('channel-inbox').click()
  await expect(page.getByTestId('timeline')).toBeVisible()
  const picker = new StampPicker(page)
  await picker.openFor(POST)
  await expect(picker.dialog).toBeVisible()
  return picker
}

test(
  'ピッカーから PNG を登録すると再読み込みなしで一覧に現れる',
  { tag: [CHANGE, '@TP-001'] },
  async ({ page }) => {
    const mock = await installApiMock(page)
    const picker = await openPicker(page, mock)

    await picker.openUploadPanel()
    await expect(picker.uploadHeading).toBeVisible()
    await picker.chooseFile(smallPng())
    await picker.submit()

    await expect(picker.searchBox).toBeVisible()
    await expect(picker.stamp('stampupload')).toBeVisible()
  },
)

test(
  '登録直後のスタンプをそのままリアクションに使える',
  { tag: [CHANGE, '@TP-002'] },
  async ({ page }) => {
    const mock = await installApiMock(page)
    const picker = await openPicker(page, mock)

    await picker.openUploadPanel()
    await picker.chooseFile(smallPng())
    await picker.submit()
    await expect(picker.stamp('stampupload')).toBeVisible()

    await picker.stamp('stampupload').click()

    const reaction = picker.reaction(POST, 'stampupload')
    await expect(reaction).toBeVisible()
    await expect(reaction).toHaveAttribute('aria-pressed', 'true')
    await expect(reaction).toHaveAccessibleName(/:stampupload: 1件/)
  },
)

test(
  'ファイルを選ぶと拡張子を除いたファイル名がショートコードの初期値になる',
  { tag: [CHANGE, '@TP-003'] },
  async ({ page }) => {
    const mock = await installApiMock(page)
    const picker = await openPicker(page, mock)

    await picker.openUploadPanel()
    await picker.chooseFile(smallPng('MyStamp.png'))

    await expect(picker.shortcodeInput).toHaveValue('mystamp')
  },
)

test(
  'ショートコードを書き換えると書き換えた名前で登録される',
  { tag: [CHANGE, '@TP-004'] },
  async ({ page }) => {
    const mock = await installApiMock(page)
    const picker = await openPicker(page, mock)

    await picker.openUploadPanel()
    await picker.chooseFile(smallPng())
    await expect(picker.shortcodeInput).toHaveValue('stampupload')
    await picker.fillShortcode('renamed-stamp')
    await picker.submit()

    await expect(picker.stamp('renamed-stamp')).toBeVisible()
    await expect(picker.stamp('stampupload')).toHaveCount(0)
  },
)

test(
  '導出できないファイル名ではショートコードが空で、妥当な値を入れるまで登録できない',
  { tag: [CHANGE, '@TP-005'] },
  async ({ page }) => {
    const mock = await installApiMock(page)
    const picker = await openPicker(page, mock)

    await picker.openUploadPanel()
    await picker.chooseFile(unusableNamePng())

    await expect(picker.shortcodeInput).toHaveValue('')
    await expect(picker.undeivableShortcodeHint).toBeVisible()
    await expect(picker.submitButton).toBeDisabled()

    await picker.fillShortcode('nihongo')
    await expect(picker.submitButton).toBeEnabled()
    expect(mock.emojiUploadRequestCount()).toBe(0)
  },
)

test(
  '対応形式外のファイルは要求を送らずに理由を示す',
  { tag: [CHANGE, '@TP-006'] },
  async ({ page }) => {
    const mock = await installApiMock(page)
    const picker = await openPicker(page, mock)

    await picker.openUploadPanel()
    await picker.chooseFile(unsupportedFormat())

    await expect(picker.error).toContainText('image/png')
    await expect(picker.error).toContainText('image/gif')
    await expect(picker.submitButton).toBeDisabled()
    expect(mock.emojiUploadRequestCount()).toBe(0)
  },
)

test(
  '上限サイズ超過のファイルは要求を送らずに上限値を示す',
  { tag: [CHANGE, '@TP-007'] },
  async ({ page }) => {
    const mock = await installApiMock(page)
    const picker = await openPicker(page, mock)

    await picker.openUploadPanel()
    await picker.chooseFile(oversizedPng())

    await expect(picker.error).toContainText('512 KiB')
    await expect(picker.submitButton).toBeDisabled()
    expect(mock.emojiUploadRequestCount()).toBe(0)
  },
)

test(
  'ショートコードが重複すると理由が出て既存の一覧は変わらず入力が残る',
  { tag: [CHANGE, '@TP-008'] },
  async ({ page }) => {
    const mock = await installApiMock(page, { emojiUpload: 'conflict' })
    const picker = await openPicker(page, mock)

    await picker.openUploadPanel()
    await picker.chooseFile(smallPng('shipit.png'))
    await expect(picker.shortcodeInput).toHaveValue('shipit')
    await picker.submit()

    await expect(picker.error).toContainText('既に登録されています')
    // 登録パネルに留まり、選んだファイルとショートコードは残る。
    await expect(picker.uploadHeading).toBeVisible()
    await expect(picker.shortcodeInput).toHaveValue('shipit')
    await expect(picker.dialog.getByText('shipit.png')).toBeVisible()

    // 既存の一覧は壊れていない。
    await picker.backToListButton.click()
    await expect(picker.stamp('shipit')).toBeVisible()
    await expect(picker.stamp('party')).toBeVisible()
  },
)

test(
  '登録が失敗しても入力を保持したまま再試行できる',
  { tag: [CHANGE, '@TP-009'] },
  async ({ page }) => {
    const mock = await installApiMock(page, { emojiUpload: 'error' })
    const picker = await openPicker(page, mock)

    await picker.openUploadPanel()
    await picker.chooseFile(smallPng())
    await picker.submit()

    await expect(picker.error).toBeVisible()
    await expect(picker.shortcodeInput).toHaveValue('stampupload')
    await expect(picker.submitButton).toBeEnabled()

    await picker.submit()
    await expect
      .poll(() => mock.emojiUploadRequestCount(), { message: '再試行で 2 件目の要求が飛ぶ' })
      .toBe(2)
  },
)

test(
  '登録中は進行を示し、確定を連打しても要求は 1 件に留まる',
  { tag: [CHANGE, '@TP-010'] },
  async ({ page }) => {
    const mock = await installApiMock(page, { emojiUpload: 'slow' })
    const picker = await openPicker(page, mock)

    await picker.openUploadPanel()
    await picker.chooseFile(smallPng())
    await picker.submit()

    await expect(picker.progress).toHaveText('登録中…')
    await expect(picker.submitButton).toBeDisabled()
    await picker.submitButton.click({ force: true })
    await picker.submitButton.click({ force: true })
    expect(mock.emojiUploadRequestCount()).toBe(1)

    mock.releaseEmojiUpload()
    await expect(picker.searchBox).toBeVisible()
    await expect(picker.stamp('stampupload')).toHaveCount(1)
  },
)

test(
  'カタログが空でも未登録の表示とともにスタンプを追加できる',
  { tag: [CHANGE, '@TP-011'] },
  async ({ page }) => {
    const mock = await installApiMock(page, { emptyEmojiCatalog: true })
    const picker = await openPicker(page, mock)

    await expect(picker.emptyCatalogNotice).toBeVisible()
    await expect(picker.addStampButton).toBeEnabled()

    await picker.openUploadPanel()
    await picker.chooseFile(smallPng())
    await picker.submit()

    await expect(picker.stamp('stampupload')).toBeVisible()
    await expect(picker.emptyCatalogNotice).toHaveCount(0)
  },
)

test(
  'GIF を登録すると一覧で画像として表示される',
  { tag: [CHANGE, '@TP-012'] },
  async ({ page }) => {
    const mock = await installApiMock(page)
    const picker = await openPicker(page, mock)

    await picker.openUploadPanel()
    await picker.chooseFile(animatedGif())
    await expect(picker.shortcodeInput).toHaveValue('stampanimated')
    await picker.submit()

    await expect(picker.stamp('stampanimated')).toBeVisible()
    // ショートコードのテキストへのフォールバックではなく画像が出る。
    await expect(picker.stampImage('stampanimated')).toBeVisible()
    await expect(picker.stampFallback('stampanimated')).toHaveCount(0)

    await picker.stamp('stampanimated').click()
    await expect(picker.reaction(POST, 'stampanimated')).toBeVisible()
  },
)
