import type { Page } from '@playwright/test'

/**
 * clock:idle — Playwright の時計の制御で、操作の無い時間を進める。
 *
 * `installIdleClock` はページを開く前に呼ぶ（Date・setTimeout・setInterval を差し替える）。
 * 差し替えた後も時間は普通に流れ、`idle` を呼んだときだけ指定の時間を一気に進める。
 * 進めた間に期限の来たタイマーは一度ずつ発火する（ノート PC の蓋を閉じて開いたのと同じ）。
 * 進める間に入力のイベントは起きないので、「操作が無いまま時間が経つ」状態になる。
 */
export async function installIdleClock(page: Page) {
  await page.clock.install()
}

export async function idle(page: Page, duration: string | number) {
  await page.clock.fastForward(duration)
}
