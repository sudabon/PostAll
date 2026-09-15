## Context

動機は proposal.md - Why を参照。要求は specs/ 配下の delta を参照。

現状、新規投稿・返信・削除は `frontend/src/hooks/usePosts.ts` の `usePostMutations()` で `mutationFn` → `onSuccess: invalidate` だけの構成になっている。`Timeline.tsx` / `ThreadPanel.tsx` は `create` / `reply` を `mutateAsync` で await しており、`Composer.submit` はその解決まで `sending` を立てて入力欄ごと無効化する。削除は `mutate` の投げっぱなしで、行が消えるのは invalidate 後の再取得が終わってからになる。

編集とリアクションの楽観的更新は既にあり（`usePosts.ts` の `edit`、`useReactions.ts`）、`onMutate` でキャッシュ書き換え → `onError` でスナップショット復元 → `onSuccess` でサーバー値へ差し替え → `onSettled` で invalidate という構成を共有している。キャッシュ走査は `lib/post-cache.ts` が infinite query 形（`{pages: [{posts}]}`）と thread 形（`{root, replies}`）の両方を1つの関数で歩く。

この変更に効く制約:

- `useChangeSync` が realtime とポーリングで `['posts', channelId]` / `['thread', id]` を invalidate する。**他人の投稿ひとつで再取得が走る**ため、楽観反映中も外から任意のタイミングでキャッシュが上書きされうる。
- 新規投稿の id はサーバーが採番する。クライアントは確定まで id を持てない。
- 送信に失敗したポストは「再送または破棄を選ぶまで画面に残る」ことが要求されている。この行は再取得の結果には決して含まれない。
- トースト等のグローバルな通知基盤は無い。失敗の提示は対象の行の中に置く。
- `Composer` は送信ボタンの活性を `mutationDisabled={!canMutate}` で制御しており、接続断が判明している間は送信操作そのものができない。

## Goals / Non-Goals

**Goals:**

- 保留中（送信中・送信失敗・削除中）の表示が、外からの再取得によって消えたり戻ったりしないこと。
- 確定前のポストに対して、id を必要とする操作（編集・削除・リアクション・スレッド）を構造的に到達不能にすること。「押せるが失敗する」を作らない。
- 既存の `edit` / リアクションの mutation 構成を壊さず、そこへ足す形にすること。

**Non-Goals:**

- 編集の楽観的更新の作り替え。既存のキャッシュ書き換え方式のまま残す。
- 送信・削除の自動リトライ、キューイング、オフライン中の保留送信。再送・再試行はいずれもユーザーの明示操作に限る。
- 保留中の投稿・失敗した投稿の永続化（後述の決定 6）。
- 確定前の返信による返信件数・最終返信日時の先行更新。

## Decisions

### 1. 保留中の行は React Query キャッシュに載せず、別レイヤーに持って描画時に重ねる

`state/ui.ts` に保留レイヤーを置き、`Timeline` / `ThreadPanel` が `flattenPages` の結果に重ねて描画する。

- `pendingPosts: PendingPost[]` — `{ key, channelId, threadRootId, body, attachments, createdAt, status: 'sending' | 'failed' }`
- `deletingPostIds: string[]` — 楽観的に非表示にしている id
- `failedDeletes: Record<string, string>` — 削除に失敗した id → 表示する文言

描画は「取得結果から `deletingPostIds` を除外し、末尾に当該チャネル／スレッドの `pendingPosts` を並べる」だけになる。

*なぜキャッシュではないか*: `useChangeSync` の invalidate は楽観反映の途中でも走る。キャッシュへ差し込んだ仮の行は、無関係な他人の投稿が1件届くだけで再取得に上書きされて消える。さらに「失敗した行は再送・破棄を選ぶまで残る」は、再取得結果に決して含まれない行を持ち続けることを意味し、サーバー応答由来のキャッシュには原理的に置けない。削除側も同じで、`deletingPostIds` を持たないと再取得のたびに削除済みの行が一瞬戻る。

*代替案 A*: 編集と同じくキャッシュを直接書き換え、`onSettled` の invalidate に任せる。却下 — 上記のとおり失敗行を保持できず、確定までの間の再取得で表示が壊れる。
*代替案 B*: TanStack Query の `useMutationState` で進行中の variables を読み、それを描画する。却下 — 失敗した mutation は再送・破棄まで残す必要があり、mutation の寿命と表示の寿命が一致しない。破棄の操作をキャッシュの掃除として表現することにもなる。

### 2. 確定前の行は既存の行コンポーネントを使わず、専用の行として描く

`PostRow` / `ThreadReply` は `Post` を受け取り、`PostActions`・`ReactionBar`・スレッド導線を必ず描く。確定前のポストには id が無いため、これらに渡せる値が無い。偽の `Post` を組み立てて流し込むと、押せてしまう導線を個別に無効化して回ることになる。

`PendingPostRow` を新設し、本文・添付・時刻と、失敗時の文言および［再送］［破棄］だけを持たせる。確定した時点で保留が解け、通常の `PostRow` として描き直される。

*代替案*: `PostRow` に `pending` フラグを足して分岐する。却下 — 「id がある行」と「id が無い行」を1つのコンポーネントが両方扱うことになり、確定前に操作導線が出ない保証がフラグの網羅性に依存する。

### 3. 確定・削除成功はキャッシュへ直接反映してから保留を解く

`onSuccess` の中で、キャッシュへの反映と保留レイヤーの解除を同じ同期ブロックで行う。

- 投稿・返信: サーバーが返した `Post` を `insertPostInQueryData` でキャッシュへ入れてから、当該 `pendingPosts` を取り除く。
- 削除: `removePostFromQueryData` でキャッシュから取り除いてから、`deletingPostIds` から外す。

`onSettled` の invalidate は従来どおり最後に走る。`post-cache.ts` に `insertPostInQueryData` / `removePostFromQueryData` を追加する（既存の `updatePostInQueryData` と同じく、変化が無ければ同一参照を返す方針を踏襲する）。

*なぜ順序が要るか*: 保留を先に解くと、invalidate による再取得が終わるまでの間だけ行が消える（投稿）または戻る（削除）。キャッシュを先に直しておけば、その隙間が生まれない。

### 4. 接続断は保留行を作らず、従来どおり入力をフォームに残す

`Timeline` / `ThreadPanel` の `onSubmit` は、`mutate` を呼ぶ前に `requireMutationConnection()` を呼ぶ。接続できていなければここで throw し、`Composer.submit` の既存の `catch` が入力を書き戻して失敗を示す。保留行は作られない。接続できていれば `mutate` を呼んで即座に返る（await しない）ので、フォームは空になり下書きも消える。

これにより `post-composer` の「接続できない状態では入力をフォームに残す」と `sync-and-storage` の「接続断中の投稿は下書きとして保持する」が、楽観化後もそのまま成立する。オンラインでサーバーが拒否した場合だけが、失敗した保留行になる。

*代替案*: すべての失敗を保留行に寄せる。却下 — 接続断時に下書きが消えるため、既存の「オンライン前提の接続断時の振る舞い」に反する。

### 5. 再送は同じ保留行を使い、削除の再試行は確認を求め直さない

再送は当該 `pendingPosts` の `status` を `'sending'` に戻して同じ本文・添付で `mutate` し直す。行の位置は動かさない。破棄は `pendingPosts` から取り除くだけで、サーバーへは何も送らない。

削除の再試行は `failedDeletes` のエントリを消して `deletingPostIds` へ戻し、`mutate` し直す。確認ダイアログは出さない。ユーザーは既に一度承認しており、失敗したのはサーバー側であって意思の確認ではないため。

### 6. 保留中・失敗した投稿は永続化しない

`pendingPosts` はメモリ上のみに置き、リロードやアプリ再起動では復元しない。既存の `failedEdits` と同じ扱いで、`post-composer` の「送信に失敗したポストの内容を下書きとして永続化してはならない」と整合する。

*代替案*: 失敗した保留投稿を `platform.setItem` で下書きと同様に保存し、起動時に復元する。却下 — 復元先のチャネル／スレッドの生存確認、孤児エントリの掃除、下書きとの二重管理が必要になり、得られる保証（失敗直後にリロードした場合のみ効く）に見合わない。この境界は specs の「失敗したポストは再起動をまたがない」に明示した。

## Risks / Trade-offs

**realtime が自分の投稿を mutation の応答より先に運んでくると、一瞬だけ保留行と確定行が重複して見える** → 保留の解除を `onSettled` ではなく `onSuccess` に置き、重複しうる窓を mutation の往復時間に限定する。重複は次の描画で解消し、データは壊れない。

**保留レイヤーの取りこぼしで行が残り続ける** → `onSuccess` / `onError` の双方で必ず保留を解くか `failed` へ遷移させる。`pendingPosts` は `key`（`crypto.randomUUID()`）で同定し、mutation の context 経由で受け渡す。ポスト id では同定しない（確定前は存在しないため）。

**チャネルを切り替えている間に届いた失敗が見えない** → 保留は `channelId` / `threadRootId` を持つため、当該チャネルへ戻れば失敗行はその位置に見える。ただし再起動では失われる（決定 6）。

**`state/ui.ts` が肥大する（現在 296 行）** → 保留レイヤーは `failedEdits` と同種の一時状態であり、同居させるのが自然だが、追加分で 400 行を超えるようなら `state/pending.ts` として切り出す。判断は実装時に行う。

**確定前の行に操作導線が無いことが「壊れている」と見える** → 確定前は通常より薄い表示にし、状態が過渡的であることを示す（specs の「確定済みと区別できる控えめな表示」）。通常は数百ミリ秒で解消する。

## Migration Plan

フロントエンドのみの変更で、API・データベース・保存形式に影響しない。機能フラグは設けず、リリースはそのまま。問題が出た場合は revert で従来の「応答を待ってから反映」へ戻る。永続化するデータを増やさないため、巻き戻しに伴うデータの後始末は不要。
