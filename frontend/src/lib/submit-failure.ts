export function submitFailureMessage(submitLabel: string) {
  return `${submitLabel}に失敗しました。入力は保持されています。`
}

// 保持していた入力より後にポストが更新されていた場合の文言。
// 編集フォームを開く前に古くなっていたので、その入力は復元せずに破棄する。
export const staleEditDiscardedMessage =
  '他の変更が反映されたため、保存できなかった入力は破棄されました。'

// 編集フォームを開いている最中にポストが他の場所で更新された場合の文言。
// 画面の入力は勝手に捨てず、保存すると上書きになることだけを伝える。
export const postChangedElsewhereMessage =
  'このポストは他の場所で更新されました。このまま保存すると、その変更を上書きします。'
