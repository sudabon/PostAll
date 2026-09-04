## Context

動機は proposal.md - Why を参照。

現状の編集は `frontend/src/hooks/usePosts.ts` の `usePostMutations().edit` で、`mutationFn` → `onSuccess: invalidate` だけの構成になっている。呼び出し側（`Timeline.tsx` / `ThreadPanel.tsx`）は `mutateAsync` を await し、解決してから `setEditingPost(null)` でフォームを閉じる。エラー表示は `Composer.submit` の `catch` が担っており、フォームが開いたままであることが前提になっている。

同じリポジトリにリアクションの楽観的更新が既にある（`frontend/src/hooks/useReactions.ts` + `frontend/src/lib/reactions.ts`）。`onMutate` でキャッシュ書き換え、`onError` でスナップショット復元、`onSuccess` でサーバー値へ差し替え、`onSettled` で invalidate という構成で、`['posts']`（infinite query）と `['thread']` の両方のキャッシュ形を1つの走査関数で扱っている。今回の設計はこの既存構成に合わせることを前提にする。

制約:

- トースト等のグローバルな通知基盤が無い。失敗の提示は編集フォーム内のインライン表示のみ。
- `useChangeSync` が SSE とポーリングで `['posts']` / `['thread']` を invalidate する。楽観反映中も外から再フェッチが走りうる。
- `Composer` の `onSubmit` は `(body, attachmentIds)` しか渡さない。楽観反映に必要な添付の表示情報（`fileName` / `contentType` / `sizeBytes`）は Composer の下書き状態にしか無い。

## Goals / Non-Goals

**Goals:**

- 編集の保存を既存の楽観的更新パターン（`useReactions`）と同型に揃え、新しい仕組みを増やさない。
- 楽観反映の対象を本文・添付・編集済み表示まで含め、確定直後の画面がサーバー確定後と一致するようにする。
- 失敗時に入力を失わせない現在の保証を、フォームが閉じた後でも維持する。

**Non-Goals:**

- 新規投稿・返信投稿・削除の楽観化。同じ土台に載るが本変更では触らない。
- 失敗の通知手段としての新規 UI（トースト、ポスト行のエラーバッジ、再試行ボタン）の追加。
- 保存要求のリトライ、キューイング、オフライン中の保留。

## Decisions

### 1. mutation の構成は `useReactions` と同型にする

`edit` を `onMutate` / `onError` / `onSuccess` / `onSettled` の4段に組み替える。`onMutate` で `cancelQueries` → `getQueriesData` でスナップショット取得 → `setQueriesData` で楽観反映、`onError` でスナップショットを書き戻し、`onSuccess` でサーバーが返した `Post` へ差し替え、`onSettled` で `['posts']` と `['thread']` を invalidate。

*代替案*: 呼び出し側（`Timeline.tsx` / `ThreadPanel.tsx`）で `setQueryData` してから mutate する。却下 — 巻き戻しとエラー処理が2箇所に散り、Timeline とスレッドで同じコードを二重に持つことになる。

### 2. キャッシュ走査ユーティリティを共有モジュールへ切り出す

`lib/reactions.ts` に private で置かれている `updatePostInQueryData`（infinite query 形と `{root, replies}` 形の両方を歩き、変化が無ければ同一参照を返す）を `lib/post-cache.ts` へ移して export する。`reactions.ts` はそこから import する。編集用には同モジュールに次を追加する。

- `applyPostEdit(post, { body, attachments })` — 楽観パッチ
- `replacePostInQueryData(data, post)` — サーバー返却値での置換

*代替案*: 編集側で走査ロジックを書き直す。却下 — infinite query と thread の2形を歩くロジックの重複はバグの温床になる。

### 3. 失敗した編集内容は UI ストアに保持する

`state/ui.ts` にポスト単位の `failedEdit`（本文・添付・エラー文言）を持たせる。`onError` がこれを積み、`PostEditor` が自ポストのエントリを見て `initialBody` / `initialAttachments` / 初期エラーに使う。再確定または取り消しでクリアする。永続化はしない（既存の「編集モードの入力を下書きとして永続化してはならない」に従う）。

競合時の扱いは specs のとおり: `onError` は他のポストの編集フォームが開いていなければ `setEditingPost(postId)` で再オープンし、開いていれば保持だけして奪わない。ストアをポスト単位の map にしているのはこの保留を成立させるため。

*代替案 A*: 編集用 Composer の下書き永続化を有効にして復元に使う。却下 — 取り消し時にも残ってしまい、既存の下書き仕様と衝突する。
*代替案 B*: 呼び出し側で `mutateAsync` を await して catch する。却下 — 「await しない」ことが本変更の主眼であり、Composer が既にアンマウントされているため復元先が無い。

### 4. `Composer.onSubmit` を `(body, attachmentIds, attachments)` に拡張する

第3引数として下書きから組み立てた添付情報（`id` / `fileName` / `contentType` / `sizeBytes`）を渡す。`Attachment` 型の残りのフィールド（`checksum` / `createdAt`）は描画に使われていないため楽観値では仮値を入れ、`onSuccess` でサーバー値に置き換わる。新規投稿・返信の呼び出し側は第3引数を無視する。

*代替案*: `attachmentIds` だけで既存の `post.attachments` を絞る。却下 — 除去と並び替えは即時に見えるが、編集中に追加した添付だけ応答到着まで現れず、確定直後の画面が中途半端になる。

### 5. `editedAt` は暫定値を置き、応答で上書きする

楽観反映では `editedAt` にクライアント時刻を入れて「編集済み」表示を即座に出す。表示は日時ではなくバッジのみ（`Timeline.tsx`）なので、サーバー時刻との数百ms のずれは観測されない。`onSuccess` で正規の値へ差し替わる。

### 6. 呼び出し側は `mutate` を使い await しない

`Timeline.tsx` / `ThreadPanel.tsx` の `onSave` は `setEditingPost(null)` → `edit.mutate(...)` の順で同期的に返す。`Composer.submit` は即座に解決するため `sending` 状態が画面に出ない。失敗の責務は `Composer` の `catch` から mutation の `onError` へ移る。

### 7. 接続断は `onMutate` の先頭で弾く

既存の `requireMutationConnection()` を `mutationFn` に加えて `onMutate` の先頭でも呼ぶ（`useReactions` と同じ）。キャッシュを触る前に throw するので巻き戻し対象が無く、`onError` の経路だけが走って編集フォームが復元される。

## Risks / Trade-offs

- **楽観反映中に `useChangeSync` の invalidate が走り、サーバー未反映の内容で一瞬上書きされる** → `onMutate` の `cancelQueries` は進行中のフェッチしか止められず、後発の invalidate は防げない。ただし PATCH の往復は通常数百ms で、リアクションの楽観的更新が既に同じ性質を持っている。既存と同じ挙動として受け入れ、新しい抑制機構は入れない。
- **失敗が別ポストの編集中に起きると、その場では失敗が伝わらない** → 巻き戻しで本文が元に戻るため画面上の変化はある。確実な通知にはトースト基盤が要るが、本変更のスコープ外とした（proposal - Non-Goals）。
- **`Composer.onSubmit` のシグネチャ変更が新規投稿・返信の呼び出し側にも及ぶ** → 引数の追加のみで、無視する側に変更は要らない。型で漏れが検出できる。
- **エラー表示の責務が Composer の `catch` から mutation へ移る** → 編集モードだけが mutation 側でエラーを出す構造になり、新規投稿は従来どおり Composer の `catch` が担う。編集と新規でエラー経路が分かれる分かりにくさが残るが、新規投稿の楽観化を行うまでの過渡的な状態として許容する。

## Migration Plan

フロントエンドのみの変更で、API・データ・永続化の形式は変わらない。段階的な移行やフラグは不要。問題があればリバートで元の同期フローへ戻る。
