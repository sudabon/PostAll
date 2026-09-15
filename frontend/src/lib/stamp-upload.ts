// スタンプ登録の制約。サーバ（backend/internal/emoji/constraints.go）と同じ値を
// 持ち、ユーザーがファイルを選んだ時点で弾けるようにする。最終的な判定はサーバで、
// 形式は実体の内容から判定される。

export const SHORTCODE_MAX_LENGTH = 64
export const MAX_STAMP_BYTES = 512 * 1024
export const ACCEPTED_STAMP_TYPES = ['image/png', 'image/gif'] as const
/** <input type="file"> の accept 属性に渡す値。 */
export const ACCEPTED_STAMP_ACCEPT = ACCEPTED_STAMP_TYPES.join(',')

const SHORTCODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/
const ACCEPTED_EXTENSIONS = ['.png', '.gif']

export function isValidShortcode(shortcode: string): boolean {
  return SHORTCODE_PATTERN.test(shortcode)
}

/**
 * ファイル名からショートコードのたたき台を作る。ユーザーが登録前に直せる初期値で
 * あって、正はサーバの検証。整えられない名前のときは空文字を返す。
 */
export function deriveShortcode(fileName: string): string {
  const withoutExtension = fileName.replace(/\.[^./\\]+$/, '')
  const normalized = withoutExtension
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[^a-z0-9]+/, '')
  return normalized.slice(0, SHORTCODE_MAX_LENGTH).replace(/[-_]+$/, '')
}

export function maxStampKiB(): number {
  return MAX_STAMP_BYTES / 1024
}

/**
 * 選ばれたファイルが制約を満たすかを見る。満たさないときは理由の文言を返し、
 * 満たすときは null を返す。理由を返した場合はアップロードを始めない。
 */
export function validateStampFile(file: File): string | null {
  if (!isAcceptedType(file)) {
    return `対応していない画像形式です。${ACCEPTED_STAMP_TYPES.join(' / ')} のいずれかにしてください`
  }
  if (file.size > MAX_STAMP_BYTES) {
    return `画像が大きすぎます。${maxStampKiB()} KiB 以下にしてください`
  }
  if (file.size === 0) {
    return '空のファイルは登録できません'
  }
  return null
}

function isAcceptedType(file: File): boolean {
  if ((ACCEPTED_STAMP_TYPES as readonly string[]).includes(file.type)) return true
  // 形式を報告しないブラウザ・環境がある。その場合だけ拡張子で判断し、
  // 実体の判定はサーバに委ねる。type が別の形式を名乗っている場合は弾く。
  if (file.type !== '') return false
  const name = file.name.toLowerCase()
  return ACCEPTED_EXTENSIONS.some((extension) => name.endsWith(extension))
}
