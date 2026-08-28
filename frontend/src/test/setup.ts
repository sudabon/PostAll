import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { MotionGlobalConfig } from 'motion/react'
import { afterEach } from 'vitest'

// vitest の globals を有効にしていないため、@testing-library/react の自動 cleanup が
// 登録されない（afterEach がグローバルに存在するときだけ登録される仕様）。
// アンマウントされないまま残ったツリーが環境破棄後に React のスケジューラを動かし、
// "window is not defined" で vitest が exit 1 になるため、ここで明示的に登録する。
afterEach(() => {
  cleanup()
})

MotionGlobalConfig.skipAnimations = true

if (typeof HTMLDialogElement !== 'undefined') {
  HTMLDialogElement.prototype.showModal ??= function () {
    this.open = true
  }
  HTMLDialogElement.prototype.close ??= function () {
    this.open = false
  }
}

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }),
})

if (typeof URL.createObjectURL !== 'function') {
  URL.createObjectURL = () => 'blob:mock'
}
if (typeof URL.revokeObjectURL !== 'function') {
  URL.revokeObjectURL = () => {}
}

if (typeof File !== 'undefined' && typeof File.prototype.arrayBuffer !== 'function') {
  File.prototype.arrayBuffer = function () {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as ArrayBuffer)
      reader.onerror = () => reject(reader.error)
      reader.readAsArrayBuffer(this)
    })
  }
}
