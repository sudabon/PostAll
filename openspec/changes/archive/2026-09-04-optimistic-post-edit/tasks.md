## 1. キャッシュ更新ユーティリティの共有化

- [x] 1.1 `frontend/src/lib/post-cache.test.ts` を追加し、`updatePostInQueryData` が infinite query 形（`{pages: [{posts}]}`）と thread 形（`{root, replies}`）の両方でポストを差し替えること、対象ポストが無ければ同一参照を返すことを検証する（design - Decisions 2）
- [x] 1.2 `frontend/src/lib/post-cache.ts` を新設し、`lib/reactions.ts` の private `updatePostInQueryData` / `updatePosts` / `isRecord` を移して export する
- [x] 1.3 `frontend/src/lib/reactions.ts` を `post-cache` から import する形に書き換え、`frontend/src/lib/reactions.test.ts` が変更なしで通ることを確認する
- [x] 1.4 `applyPostEdit(post, { body, attachments })`（本文・添付を差し替え `editedAt` に暫定値を入れる）と `replacePostInQueryData(data, post)` のテストを `post-cache.test.ts` に追加する
- [x] 1.5 `applyPostEdit` と `replacePostInQueryData` を `post-cache.ts` に実装する

## 2. 編集 mutation の楽観的更新

- [x] 2.1 `frontend/src/hooks/usePosts.test.tsx` に、`usePostMutations().edit` がサーバー応答の前に `['posts']` と `['thread']` のキャッシュを本文・添付・編集済み表示まで書き換えることを検証するテストを追加する（specs post-timeline - 保存の結果を待たずに反映する）
- [x] 2.2 同ファイルに、応答が返ったときサーバーが返した `Post` へ差し替わることのテストを追加する（specs post-timeline - サーバーの確定内容へ合わせる）
- [x] 2.3 同ファイルに、保存が拒否されたときキャッシュがスナップショットへ巻き戻ることのテストを追加する（specs post-timeline - 保存がサーバーで失敗する）
- [x] 2.4 `frontend/src/hooks/usePosts.ts` の `edit` を `onMutate` / `onError` / `onSuccess` / `onSettled` の4段構成へ組み替える。`onMutate` の先頭で `requireMutationConnection()` を呼ぶ（design - Decisions 1, 7）
- [x] 2.5 `edit` の入力を `{ id, body, attachmentIds, attachments }` に拡張し、`attachments` を楽観反映に使う

## 3. 失敗した編集内容の保持と復元

- [x] 3.1 `frontend/src/state/ui.ts` にポスト単位の `failedEdit`（本文・添付・エラー文言）と、その設定・クリアを行う操作を追加する。永続化キーには加えない（design - Decisions 3）
- [x] 3.2 `usePosts.test.tsx` に、保存失敗時に (a) 他の編集フォームが開いていなければ当該ポストの編集フォームが開くこと (b) 他のポストの編集フォームが開いていれば奪わず保持だけすること、のテストを追加する（specs post-composer - 別のポストを編集中に保存が失敗する）
- [x] 3.3 `edit` の `onError` に、スナップショット復元・`failedEdit` の登録・条件付きの編集フォーム再オープンを実装する
- [x] 3.4 `edit` の `onSuccess` で当該ポストの `failedEdit` をクリアする

## 4. 入力フォーム側の対応

- [x] 4.1 `frontend/src/components/composer/Composer.test.tsx` に、確定操作が `onSubmit` の第3引数へ添付のメタ情報（`id` / `fileName` / `contentType` / `sizeBytes`）を渡すことのテストを追加する（design - Decisions 4）
- [x] 4.2 同ファイルに、`initialError` を渡すと確定前からエラーが表示されることのテストを追加する
- [x] 4.3 `Composer` の `onSubmit` を `(body, attachmentIds, attachments)` に拡張し、`initialError?: string` プロップを追加する
- [x] 4.4 `frontend/src/components/post/PostEditor.tsx` を、自ポストの `failedEdit` があればそれを `initialBody` / `initialAttachments` / `initialError` に使うよう変更する（specs post-composer - 保留された失敗を後から確認する）
- [x] 4.5 編集の取り消し時に当該ポストの `failedEdit` をクリアする（specs post-composer - 失敗から再開した編集を取り消す）

## 5. 呼び出し側の切り替え

- [x] 5.1 `frontend/src/components/timeline/Timeline.tsx` の `onSave` を「`setEditingPost(null)` → `edit.mutate(...)`」へ変更し、await をやめる（design - Decisions 6）
- [x] 5.2 `frontend/src/components/thread/ThreadPanel.tsx` の `onSave` を同様に変更する
- [x] 5.3 新規投稿・返信の `onSubmit` が第3引数の追加で壊れていないことを型チェックで確認する

## 6. E2E と仕上げ

- [x] 6.1 `frontend/e2e/app.spec.ts` に、PATCH の応答を遅延させたうえで保存を押すと、応答前に編集フォームが閉じて新しい本文が表示されることを確認するテストを追加する
- [x] 6.2 同ファイルに、PATCH が 500 を返すと表示が編集前へ戻り、入力内容を復元した編集フォームが再度開いてエラーが示されることを確認するテストを追加する
- [x] 6.3 既存の編集系 E2E（`edits and deletes a thread reply...` / `opens the post editor in place...`）が通ることを確認する
- [x] 6.4 `make test`、`make lint`、`make typecheck` を実行して全て通ることを確認する
