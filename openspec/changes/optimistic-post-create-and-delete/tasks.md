## 1. 保留レイヤーの状態

- [x] 1.1 `frontend/src/state/ui.ts` に `pendingPosts` / `deletingPostIds` / `failedDeletes` と、それらを操作するアクション（保留の追加・失敗化・再送への差し戻し・破棄・解除、削除の開始・失敗・解除・再試行）を追加する。design.md の決定 1 の型に従う。`npm run typecheck` が通ることで確認する
- [x] 1.2 `frontend/src/state/ui.test.ts`（無ければ新規）に保留レイヤーの遷移テストを追加し、送信中 → 失敗 → 再送 → 解除、削除中 → 失敗 → 再試行 → 解除の各経路が期待どおり遷移することを `npm test` で確認する
- [x] 1.3 `state/ui.ts` が 400 行を超える場合は保留レイヤーを `frontend/src/state/pending.ts` へ切り出し、既存の import を更新して `npm run typecheck` と `npm test` が通ることを確認する

## 2. キャッシュ操作の追加

- [x] 2.1 `frontend/src/lib/post-cache.ts` に `insertPostInQueryData`（infinite query 形の先頭ページと thread 形の `replies` へポストを追加。既に同じ id があれば何もせず同一参照を返す）を追加する
- [x] 2.2 `frontend/src/lib/post-cache.ts` に `removePostFromQueryData`（両方の形から id 一致のポストを取り除く。該当が無ければ同一参照を返す）を追加する
- [x] 2.3 `frontend/src/lib/post-cache.test.ts` に 2.1 / 2.2 のテスト（両方のキャッシュ形、重複挿入、該当無し時の参照同一性）を追加し、`npm test` が通ることを確認する

## 3. mutation の組み替え

- [x] 3.1 `frontend/src/hooks/usePosts.ts` の `create` を `onMutate` / `onError` / `onSuccess` / `onSettled` 構成へ組み替える。`onMutate` で `pendingPosts` に `status:'sending'` で積んで `key` を context に返し、`onSuccess` で `insertPostInQueryData` 後に保留を解除、`onError` で `status:'failed'` へ遷移させる
- [x] 3.2 `reply` を 3.1 と同じ構成へ組み替える。保留には `threadRootId` を持たせ、スレッド側のキャッシュへ挿入する
- [x] 3.3 `remove` を組み替える。`onMutate` で `deletingPostIds` へ追加、`onSuccess` で `removePostFromQueryData` 後に解除、`onError` で解除したうえで `failedDeletes` に記録する
- [x] 3.4 `frontend/src/hooks/usePosts.test.tsx` に、投稿・返信・削除それぞれの「即時反映される」「成功で確定へ差し替わる」「失敗で失敗状態になる」「確定前に `['posts']` を invalidate しても保留が消えない」テストを追加し、`npm test` が通ることを確認する

## 4. 確定前・失敗時の表示

- [x] 4.1 `frontend/src/components/post/PendingPostRow.tsx` を新設する。本文・添付・時刻を通常より薄い表示で描き、操作導線とリアクションを一切描かない。失敗時のみ文言と［再送］［破棄］を出す
- [x] 4.2 `frontend/src/components/post/PendingPostRow.test.tsx` を追加し、送信中は編集・削除・リアクション・スレッドの導線が存在しないこと、失敗時に再送と破棄が押せることを `npm test` で確認する
- [x] 4.3 削除に失敗したポストの行に文言と［再試行］を表示する。`Timeline.tsx` の `PostRow` と `ThreadPanel.tsx` の `ThreadReply` の双方に入れ、`ReactionBar` の失敗表示と同じ `role="alert"` の作りに揃える

## 5. 画面への結線

- [x] 5.1 `frontend/src/components/timeline/Timeline.tsx` で、`flattenPages` の結果から `deletingPostIds` を除外し、当該チャネルの `pendingPosts` を末尾へ重ねて `PendingPostRow` で描く
- [x] 5.2 `Timeline.tsx` の `Composer.onSubmit` を、`requireMutationConnection()` を呼んでから `create.mutate` を呼ぶだけの「await しない」形へ変更し、最下部への追従は保留行を積んだ直後に行う。接続断では throw して Composer 側で入力が戻ることを確認する
- [x] 5.3 `frontend/src/components/thread/ThreadPanel.tsx` で 5.1 / 5.2 と同じ結線を返信に対して行う。確定前の返信がタイムライン側の返信件数を変えないことを確認する
- [x] 5.4 `frontend/src/components/timeline/Timeline.test.tsx` と `ThreadPanel` のテストに、送信直後に行が現れること・削除承認直後に行が消えること・削除失敗で行が元の位置へ戻ることを追加し、`npm test` が通ることを確認する

## 6. E2E と仕上げ

- [x] 6.1 `frontend/e2e/app.spec.ts` に「送信操作の直後にポストが表示され、入力欄が空でそのまま次を打てる」「削除の承認直後に行が消える」の E2E を追加する。`e2e-conventions` スキルの規約に従い、`npm run test:e2e` が通ることを確認する
- [x] 6.2 `frontend/e2e/mock.ts` で作成・削除を失敗させられるようにし、送信失敗で行が失敗状態になり再送・破棄が効くこと、削除失敗で行が戻り再試行が効くことの E2E を追加して `npm run test:e2e` が通ることを確認する
- [ ] 6.3 `make lint`・`make typecheck`・`make test` をすべて実行し、通ることを確認する
- [x] 6.4 `openspec validate optimistic-post-create-and-delete --strict` が通ることを確認し、実装が delta spec のシナリオをすべて満たしているか突き合わせる
