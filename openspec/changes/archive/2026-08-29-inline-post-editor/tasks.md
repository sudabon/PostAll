## 1. 編集状態の土台

- [x] 1.1 `frontend/src/state/ui.ts` に `editingPostId: string | null` と `setEditingPost(id: string | null)` を追加する。`persistedKeys` には加えない
- [x] 1.2 チャネル切替・スレッド切替・対象ポストの消失で編集状態が残らないよう、`selectChannel` と `openThread` で `editingPostId` を落とす
- [x] 1.3 `frontend/src/state/ui.test.ts` に単体テストを追加する。同時に 1 件しか保持しないこと、永続化されないこと、チャネル切替で解除されること

## 2. Composer の編集モード

- [x] 2.1 `DraftFile` 型を、アップロード済み添付も表現できる形へ広げる。バイト列を持たず名前・サイズ・`id` のみの項目を許容する
- [x] 2.2 `Composer` に `initialBody` / `initialAttachments` / `submitLabel` / `onCancel` / `persistDraft` を追加する
- [x] 2.3 `persistDraft` が偽のとき、下書きの読み込みと保存を両方とも行わないようにする。新規投稿側の下書きに触れないことを確認する
- [x] 2.4 既存添付を `status: 'ready'` の項目として初期化し、保存時は `status === 'ready'` の `id` を集めて渡す
- [x] 2.5 `onCancel` があるときだけ取り消しボタンを表示し、Escape でも同じ経路を通す
- [x] 2.6 編集モードではタッチ端末でもマウント時に本文へフォーカスする（常設フォームの自動フォーカス抑止の例外）
- [x] 2.7 `frontend/src/components/composer/Composer.test.tsx` に編集モードのテストを追加する。初期値の投入、既存添付の引き継ぎと除去、下書きを読み書きしないこと、取り消し

## 3. PostActions からダイアログを外す

- [x] 3.1 `PostActions` から `<dialog>` と `useOverlayPresence` の利用、本文 state・添付選択 state・保存処理を削除する
- [x] 3.2 鉛筆ボタンを `setEditingPost(post.id)` の呼び出しだけにする。`aria-haspopup="dialog"` と `aria-expanded` を外す
- [x] 3.3 編集終了時にフォーカスを鉛筆ボタンへ戻す仕組みを残す（`editingPostId` が当該ポストから外れたときに復帰）
- [x] 3.4 削除ボタンと表示制御（ホバー・フォーカスでの出現）は変更しない
- [x] 3.5 `frontend/src/components/post/PostActions.test.tsx` を作り直す。編集トリガーが状態を切り替えること、削除の確認が従来どおりであること

## 4. 呼び出し箇所のインライン化

- [x] 4.1 `frontend/src/components/timeline/Timeline.tsx` の `PostRow` で、`editingPostId === post.id` のとき `PostBody` を編集フォームへ差し替える
- [x] 4.2 `frontend/src/components/thread/ThreadPanel.tsx` の返信で同じ差し替えを行う
- [x] 4.3 保存で `onEdit(body, attachmentIds)` を呼び、成功後に `setEditingPost(null)` する。本文と添付が両方空なら保存を拒否してエラーを表示する
- [x] 4.4 編集フォームのマウント後に `scrollIntoView({ block: 'nearest' })` で可視領域へ入れる

## 5. タイムライン追従の停止

- [x] 5.1 `Timeline` の `ResizeObserver` コールバックで `useUi.getState().editingPostId` を参照し、非 null の間は `pinToBottom` を呼ばない
- [x] 5.2 `onScroll` でも編集中は `pinnedToBottom` を書き換えない
- [x] 5.3 編集終了後に従来どおり追従が再開されることを確認する（編集前の値をそのまま残す方針で追加の復元処理を入れない）

## 6. E2E と実機確認

- [x] 6.1 `frontend/e2e/app.spec.ts` の既存編集フロー（`edits and deletes a thread reply and refreshes the root reply count`）をインライン編集のセレクタへ更新する
- [x] 6.2 編集フォームが当該ポストの位置に開き、モーダルが出ないことの E2E を追加する
- [x] 6.3 編集中に外部ポストが届いてもタイムラインが最下部へ飛ばないことの E2E を追加する
- [x] 6.4 別のポストの編集を始めると先の編集フォームが閉じることの E2E を追加する
- [x] 6.5 狭幅（390×844）で編集フォームが可視領域に入ることを確認する
- [x] 6.6 `npm run typecheck` / `npm test` / `npx playwright test` / `npm run lint` をすべて通す
- [x] 6.7 iPhone 実機で編集を開き、キーボード出現後も編集箇所が見えるかを確認する。必要なら可視化スクロールをキーボード確定後にも実行する

## 7. 仕上げ

- [x] 7.1 design.md の Open Questions を解消し、決めた内容を反映する（既存画像のサムネイル、Shift+Enter での保存、キーボード後の再スクロール）
- [x] 7.2 `openspec validate inline-post-editor --strict` を通す
