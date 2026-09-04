// スタンプ登録のテストで使う画像ファイル fixture。
// setInputFiles に渡すペイロードとしてコードから作る。バイナリをリポジトリに
// 置かないことで、サイズや形式の意図がテストから読めるようにしている。

const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
)
const ANIMATED_GIF = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH/C05FVFNDQVBFMi4wAwEAAAAh+QQEAAAAACwAAAAAAQABAAACAkQBACH5BAQAAAAALAAAAAABAAEAAAICRAEAOw==',
  'base64',
)

export type StampFilePayload = {
  name: string
  mimeType: string
  buffer: Buffer
}

/** file:small-png — 上限に十分収まる PNG。 */
export function smallPng(name = 'stampupload.png'): StampFilePayload {
  return { name, mimeType: 'image/png', buffer: ONE_PIXEL_PNG }
}

/** file:animated-gif — アニメーションを含む GIF。 */
export function animatedGif(name = 'stampanimated.gif'): StampFilePayload {
  return { name, mimeType: 'image/gif', buffer: ANIMATED_GIF }
}

/** file:unsupported-format — PNG でも GIF でもないファイル。 */
export function unsupportedFormat(): StampFilePayload {
  return {
    name: 'notes.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('これは画像ではありません', 'utf8'),
  }
}

/** file:oversized-png — 上限サイズ（512 KiB）を 1 バイト超える PNG。 */
export function oversizedPng(): StampFilePayload {
  const limit = 512 * 1024
  const buffer = Buffer.alloc(limit + 1)
  ONE_PIXEL_PNG.copy(buffer)
  return { name: 'oversized.png', mimeType: 'image/png', buffer }
}

/** file:unusable-name-png — ショートコードに整えられないファイル名の PNG。 */
export function unusableNamePng(): StampFilePayload {
  return smallPng('日本語.png')
}
