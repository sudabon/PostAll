import type { Locator, Page } from '@playwright/test'
import type { StampFilePayload } from '../fixtures/stamps'

/**
 * リアクションピッカーと、その中のスタンプ登録パネルの操作。
 * セレクタはここだけに置く。
 */
export class StampPicker {
  constructor(private readonly page: Page) {}

  post(body: string): Locator {
    return this.page.locator('article').filter({ hasText: body })
  }

  get dialog(): Locator {
    return this.page.getByRole('dialog', { name: 'リアクションを追加' })
  }

  get addStampButton(): Locator {
    return this.dialog.getByRole('button', { name: 'スタンプを追加' })
  }

  get uploadHeading(): Locator {
    return this.dialog.getByRole('heading', { name: 'スタンプを追加' })
  }

  get backToListButton(): Locator {
    return this.dialog.getByRole('button', { name: 'スタンプの一覧に戻る' })
  }

  get fileInput(): Locator {
    return this.dialog.getByLabel('スタンプの画像ファイル')
  }

  get shortcodeInput(): Locator {
    return this.dialog.getByLabel('ショートコード', { exact: true })
  }

  get submitButton(): Locator {
    return this.dialog.getByRole('button', { name: '登録する' })
  }

  get error(): Locator {
    return this.dialog.getByRole('alert')
  }

  get progress(): Locator {
    return this.dialog.getByRole('status')
  }

  get searchBox(): Locator {
    return this.dialog.getByRole('searchbox', { name: 'ショートコードで絞り込み' })
  }

  get emptyCatalogNotice(): Locator {
    return this.dialog.getByText('絵文字はまだ登録されていません')
  }

  get undeivableShortcodeHint(): Locator {
    return this.dialog.getByText('ファイル名から決められませんでした。ショートコードを入力してください')
  }

  /** 一覧に並ぶスタンプの選択ボタン。 */
  stamp(shortcode: string): Locator {
    return this.dialog.getByRole('button', { name: `:${shortcode}:` })
  }

  /** 一覧に並ぶスタンプの画像。装飾扱いの img なので role では引けない。 */
  stampImage(shortcode: string): Locator {
    return this.stamp(shortcode).getByTestId('emoji-image')
  }

  /** 画像を読めなかったときのショートコードのテキスト表示。 */
  stampFallback(shortcode: string): Locator {
    return this.stamp(shortcode).getByTestId('emoji-fallback')
  }

  /** ポスト下部に出るリアクションの表示。 */
  reaction(postBody: string, shortcode: string): Locator {
    return this.post(postBody).getByRole('button', { name: new RegExp(`:${shortcode}: \\d+件`) })
  }

  async openFor(postBody: string): Promise<void> {
    await this.post(postBody).getByRole('button', { name: 'リアクションを追加' }).click()
  }

  async openUploadPanel(): Promise<void> {
    await this.addStampButton.click()
  }

  async chooseFile(payload: StampFilePayload): Promise<void> {
    await this.fileInput.setInputFiles(payload)
  }

  async fillShortcode(shortcode: string): Promise<void> {
    await this.shortcodeInput.fill(shortcode)
  }

  async submit(): Promise<void> {
    await this.submitButton.click()
  }
}
