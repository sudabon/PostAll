# API REFERENCE

PostAll の HTTP API 一覧。仕様の正は [`api/openapi.yaml`](api/openapi.yaml) で、この文書はそこから読み取れる内容と Go 実装（`backend/internal/httpapi/`）の挙動をまとめたもの。ハンドラは oapi-codegen が `operationId` から生成したメソッド名で対応する。

- ベース URL: 本番 `https://memo.sudabon.com`、ローカルは同一オリジン（Vite 経由）または `http://127.0.0.1:8080`
- コンテンツタイプ: リクエスト・レスポンスとも `application/json`（絵文字画像を除く）
- 認証: `Authorization: Bearer <Supabase Auth の access token>`。`/v1/*` は全て必須
- すべてのレスポンスに `X-Request-ID` が付く。クライアントが同名ヘッダで UUID を送ればそれを引き継ぐ

## エンドポイント一覧

### ops

| メソッド | パス | 説明 | 認証 | ハンドラ |
|---|---|---|---|---|
| GET | `/health` | 稼働確認。DB へ ping する | 不要 | `Server.GetHealth` |
| GET | `/ready` | `/health` と同一の実装 | 不要 | `Server.GetHealth` |
| POST · GET | `/internal/attachments/reap` | 未使用・削除保留の添付を Storage ごと回収する | `CRON_SECRET` | `Server.ReapAttachments` |
| POST · GET | `/internal/events/prune` | 保持期間を過ぎた変更イベントを削除する | `CRON_SECRET` | `Server.PruneChangeEvents` |

### channels

| メソッド | パス | 説明 | ハンドラ |
|---|---|---|---|
| GET | `/v1/channels` | チャネル階層を一覧する | `Server.ListChannels` |
| POST | `/v1/channels` | チャネルを作成する | `Server.CreateChannel` |
| PATCH | `/v1/channels/{channelId}` | チャネルをリネームする | `Server.RenameChannel` |
| DELETE | `/v1/channels/{channelId}` | ポストを持たないチャネルを削除する | `Server.DeleteChannel` |
| POST | `/v1/channels/{channelId}/move` | 親の付け替えと並び替え | `Server.MoveChannel` |

### posts

| メソッド | パス | 説明 | ハンドラ |
|---|---|---|---|
| GET | `/v1/channels/{channelId}/posts` | チャネル直下のポストを keyset で取得する | `Server.ListChannelPosts` |
| POST | `/v1/channels/{channelId}/posts` | チャネル直下にポストを作成する | `Server.CreateChannelPost` |
| PATCH | `/v1/posts/{postId}` | ポスト本文を上書きする | `Server.EditPost` |
| DELETE | `/v1/posts/{postId}` | ポストを論理削除する | `Server.DeletePost` |
| GET | `/v1/posts/{postId}/thread` | 親ポストと返信を古い順で取得する | `Server.GetThread` |
| POST | `/v1/posts/{postId}/replies` | スレッドへ返信する | `Server.CreateReply` |

### attachments

| メソッド | パス | 説明 | ハンドラ |
|---|---|---|---|
| POST | `/v1/attachments/uploads` | アップロード用の署名付き URL を発行する | `Server.StartAttachmentUpload` |
| POST | `/v1/attachments/{attachmentId}/complete` | アップロード完了を通知しメタデータを確定する | `Server.CompleteAttachment` |
| GET | `/v1/attachments/{attachmentId}/download` | ダウンロード用の短期署名付き URL を発行する | `Server.GetAttachmentDownload` |

### emojis / reactions

| メソッド | パス | 説明 | ハンドラ |
|---|---|---|---|
| GET | `/v1/emojis` | 登録済みのカスタム絵文字を一覧する | `Server.ListEmojis` |
| POST | `/v1/emojis` | カスタム絵文字を 1 件登録する | `Server.CreateEmoji` |
| GET | `/v1/emojis/{shortcode}/image` | 絵文字画像（PNG / GIF を API が配信） | `Server.GetEmojiImage` |
| PUT | `/v1/posts/{postId}/reactions/{emojiId}` | リアクションを付与する | `Server.AddReaction` |
| DELETE | `/v1/posts/{postId}/reactions/{emojiId}` | 自身のリアクションを解除する | `Server.RemoveReaction` |

### search / events

| メソッド | パス | 説明 | ハンドラ |
|---|---|---|---|
| GET | `/v1/search` | ポスト本文を全文検索する | `Server.SearchPosts` |
| GET | `/v1/events` | 指定したイベント ID より後の変更を取得する | `Server.ListChangeEvents` |

## 共通のエラー形式

`default` レスポンスは全て次の形。`details` は一部のエラーのみ。

```json
{
  "code": "channel_has_posts",
  "message": "ポストが存在するため削除できません",
  "details": { "count": 12 }
}
```

| `code` | HTTP | 発生条件 |
|---|---|---|
| `validation` | 400 | リクエストボディ・クエリパラメータが不正 |
| `empty_content` | 400 | 本文も添付も空のポスト作成 |
| `payload_too_large` | 400 | 添付が 25 MiB を超える |
| `unsupported_media_type` | 400 | 許可されていない MIME |
| `upload_incomplete` | 400 | `complete` 時に Storage 上の実体が無い、またはサイズが申告と一致しない |
| `invalid_request` | 400 | multipart のアップロード本文を読み取れない |
| `invalid_shortcode` | 400 | 絵文字のショートコードが `^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$` に合わない |
| `image_required` | 400 | 絵文字の登録要求に画像のパートが無い |
| `unsupported_image` | 400 | 絵文字の実体が PNG でも GIF でもない |
| `unauthorized` | 401 | JWT が無い・検証に失敗・`CRON_SECRET` 不一致 |
| `forbidden` | 403 | 他人がアップロードした添付を確定・取得しようとした |
| `not_found` | 404 | 対象のチャネル・ポスト・添付・絵文字が無い |
| `name_conflict` | 409 | 同じ階層に同名のチャネルがある |
| `cycle` | 409 | 自身または子孫を親に指定した |
| `channel_has_posts` | 409 | ポストが残っているチャネルの削除（`details.count`） |
| `post_deleted` | 409 | 削除済みポストの編集・リアクション |
| `shortcode_conflict` | 409 | 既に登録済みのショートコードで絵文字を登録しようとした |
| `image_too_large` | 413 | 絵文字の画像が 512 KiB を超える |
| `internal` | 500 | 想定外の失敗。詳細はサーバログ（`X-Request-ID` で追跡） |
| `unavailable` | 503 | DB・添付ストレージ・絵文字ストレージ・JWKS へ到達できない |

JWKS が一時的に取得できない場合は 401 ではなく 503 を返す。クライアントはサインアウトさせずリトライする。

## エンドポイント詳細

### GET /health · GET /ready

認証不要。DB 未接続（`DATABASE_URL` 未設定）でも 200 を返し、`database` が `skipped` になる。

```json
{ "status": "ok", "database": "ok" }
```

| フィールド | 値 |
|---|---|
| `status` | `ok` / `unhealthy` |
| `database` | `ok` / `skipped` / `unreachable` |

DB へ ping できないときだけ 503 + `unhealthy` / `unreachable`。

---

### GET /v1/channels

階層関係と並び順を復元できる全チャネルを返す。ページングは無い。

```json
{
  "channels": [
    {
      "id": "…", "parentId": null, "name": "general",
      "sortKey": "m", "createdAt": "…", "updatedAt": "…"
    }
  ]
}
```

`sortKey` は分数インデックス（`internal/sortkey`）。同一 `parentId` 内で辞書順に並べるとユーザーが指定した順序になる。

### POST /v1/channels

```json
{ "name": "design", "parentId": null }
```

`name` は空白のみ不可。同一階層で重複すると `name_conflict`。201 で作成されたチャネルを返す。

### PATCH /v1/channels/{channelId}

`{ "name": "新しい名前" }`。200 で更新後のチャネル。

### DELETE /v1/channels/{channelId}

204。ポストが 1 件でも残っていれば `channel_has_posts`（`details.count` に件数）。子チャネルは DB の `on delete cascade` で連鎖削除される。

### POST /v1/channels/{channelId}/move

親の付け替えと兄弟内の並び替えを 1 回で行う。

```json
{ "parentId": "…", "beforeId": "…", "afterId": null }
```

| フィールド | 意味 |
|---|---|
| `parentId` | 新しい親。`null` でルート直下へ |
| `beforeId` | このチャネルの直前に挿入。省略・`null` なら末尾 |
| `afterId` | このチャネルの直後に挿入 |

自身または子孫を `parentId` に指定すると `cycle`。移動先で名前が衝突すると `name_conflict`。200 で更新後のチャネルを返す。

---

### GET /v1/channels/{channelId}/posts

`thread_root_id` が null の行（＝タイムラインに出るルートポスト）だけを **昇順** で返す。

| クエリ | 型 | 既定 | 説明 |
|---|---|---|---|
| `limit` | integer 1–50 | 10 | 取得件数 |
| `before` | string | — | このカーソルより古いポストを取る。`nextBefore` の値を渡す |
| `around` | uuid | — | 検索結果から移動するとき、このルートポストを含む履歴を返す |

カーソル無しなら最新 `limit` 件を昇順で返す。

```json
{
  "posts": [ /* Post */ ],
  "nextBefore": "1712345678901|0193…"
}
```

`nextBefore` が `null` ならこれ以上過去は無い。

**Post オブジェクト**

| フィールド | 型 | 説明 |
|---|---|---|
| `id` / `channelId` / `authorId` | uuid | |
| `threadRootId` | uuid \| null | 返信ならスレッド親の ID |
| `body` | string | Markdown |
| `createdAt` / `updatedAt` | date-time | |
| `editedAt` | date-time \| null | 編集済みなら値が入る |
| `deleted` | boolean | 論理削除済み。返信が残るスレッド親のプレースホルダでのみ true |
| `replyCount` | integer | 返信数 |
| `lastReplyAt` | date-time \| null | 最終返信時刻 |
| `attachments` | Attachment[] | |
| `reactions` | Reaction[] | 最初に付与された順の集計 |

### POST /v1/channels/{channelId}/posts

```json
{ "body": "本文", "attachmentIds": ["…"] }
```

`body` と `attachmentIds` の両方が空だと `empty_content`（`body` は空白のみも空とみなす）。`attachmentIds` は最大 10 件で、各要素は **`complete` 済み・自分がアップロード・未紐付け・削除保留でない** 添付でなければならない。条件を満たさない ID があると `validation`（「添付を紐付けできません」）。201 で作成された Post を返す。

### PATCH /v1/posts/{postId}

```json
{ "body": "書き換えた本文", "attachmentIds": ["…"] }
```

`attachmentIds` を **指定した場合のみ** 添付集合を置き換える。省略時は既存の添付を維持する。置き換えで外れた添付は回収対象になる。削除済みポストの編集は `post_deleted`。

### DELETE /v1/posts/{postId}

204。物理削除ではなく `deleted_at` を立てる論理削除。返信を持つスレッド親は `deleted: true` のプレースホルダとして残り、スレッドの繋がりが切れない。

### GET /v1/posts/{postId}/thread

```json
{ "root": { /* Post */ }, "replies": [ /* Post（古い順） */ ] }
```

`postId` にはルート・返信のどちらを渡してもよい。返信を渡した場合もそのスレッド全体を返す。

### POST /v1/posts/{postId}/replies

ボディは `CreatePostRequest`（作成と同じ）。201 で作成された返信を返す。`postId` が返信の場合も、同じスレッドのルートに紐付く。

---

### POST /v1/attachments/uploads

```json
{
  "fileName": "spec.pdf",
  "contentType": "application/pdf",
  "sizeBytes": 102400,
  "checksum": "<SHA-256 の hex>"
}
```

201:

```json
{
  "id": "…",
  "uploadUrl": "https://…",
  "headers": { "Content-Type": "application/pdf" }
}
```

クライアントは `uploadUrl` へ `headers` を付けて本体を PUT する。API は本体を経由しない。

**制限**（`backend/internal/attachment/limits.go`, `mime.go`）

| 項目 | 値 |
|---|---|
| 最大サイズ | 25 MiB |
| 1 ポストあたり | 10 件 |
| 未紐付けの保持 | 1 時間（超過分は reaper が回収） |
| 許可 MIME | `image/jpeg` `image/png` `image/gif` `image/webp` `application/pdf` `text/plain` `text/markdown` `application/zip` および Office Open XML の docx / xlsx / pptx |

### POST /v1/attachments/{attachmentId}/complete

ボディ無し。Storage への PUT 完了後に呼ぶ。実体の存在と `sizeBytes` の一致を検証し、200 で確定した Attachment を返す。冪等で、確定済みの添付を再度呼んでも 200 を返す。

| 状況 | 応答 |
|---|---|
| 実体が無い / サイズ不一致 | 400 `upload_incomplete` |
| 他人がアップロードした添付 | 403 `forbidden` |
| ID が存在しない | 404 `not_found` |

### GET /v1/attachments/{attachmentId}/download

```json
{ "url": "https://…", "expiresAt": "2026-08-28T12:00:00Z" }
```

短期の署名付き URL（有効期間 5 分）。Storage を直接公開せず、都度発行する。

| 状況 | 応答 |
|---|---|
| ポストに紐付いている | サインイン済みなら誰でも取得可 |
| ポストが論理削除済み | 404 `not_found` |
| まだポストに紐付いていない | アップロード者のみ取得可。他人は 403 `forbidden` |
| `complete` 未実施 | 404 `not_found` |

---

### GET /v1/emojis

```json
{
  "emojis": [
    { "id": "…", "shortcode": "tada", "imagePath": "…", "checksum": "…" }
  ]
}
```

カタログの登録経路は 2 つある。`emoji/` ディレクトリの一括登録（`postall-server emoji-sync` がデプロイ工程で Storage と DB へ同期。png のみ）と、`POST /v1/emojis` による 1 件登録。どちらで登録された絵文字も一覧とリアクションでの扱いは同じ。

### POST /v1/emojis

`multipart/form-data`。サインイン済みであれば誰でも登録できる。

| パート | 内容 |
|---|---|
| `shortcode` | `^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$`。既存と重複すると 409 |
| `file` | PNG または GIF。**512 KiB** 以下 |

- 形式はファイル名の拡張子やパートの `Content-Type` ではなく、**実体の先頭のシグネチャ**で判定する。申告と中身が食い違うファイルは `unsupported_image`。
- 成功は **201** で `Emoji` オブジェクト。`storage_key` は `emojis/<uuid>.<ext>` で、登録ごとに一意（重複した要求が既存の実体を上書きしないため）。
- 重複したショートコードは `shortcode_conflict` で拒否し、既存の絵文字・その画像・リアクションとの結び付きを一切変更しない。
- 実体を Storage へ置いた後に DB への記録が失敗した場合、そのオブジェクトは孤児として残るが、`storage_key` を指す行が無いため一覧にも配信にも現れない。回収は行っていない。

### GET /v1/emojis/{shortcode}/image

`shortcode` は `^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$`。Bearer 認証が要るため `<img src>` では直接読めず、クライアントは fetch して blob URL 化する。

| 挙動 | 内容 |
|---|---|
| 成功 | API が実体を配信する（署名付き URL へのリダイレクトはしない）。形式は `Content-Type`（`image/png` / `image/gif`） |
| キャッシュ | `Cache-Control: private, max-age=60`、`ETag` はチェックサム |
| 再検証 | `If-None-Match` が一致すれば 304 |
| 実体無し | 404 `not_found` |

### PUT /v1/posts/{postId}/reactions/{emojiId}

ボディ無し。冪等で、既に付与済みでも 200 で更新後の Post を返す。削除済みポストへは `post_deleted`。

### DELETE /v1/posts/{postId}/reactions/{emojiId}

204。自分の付与分のみ解除する。

**Reaction オブジェクト**

| フィールド | 説明 |
|---|---|
| `emoji` | Emoji オブジェクト |
| `count` | 付与人数（1 以上） |
| `reactedByMe` | 呼び出し元が付与済みか |
| `reactorIds` | 付与者 ID。`reactedByMe` が true なら自分が先頭 |

---

### GET /v1/search

| クエリ | 型 | 既定 | 説明 |
|---|---|---|---|
| `q` | string（2 文字以上、必須） | — | 検索語 |
| `channelId` | uuid | — | チャネルで絞る |
| `createdFrom` / `createdTo` | date-time | — | 作成日時で絞る |
| `limit` | integer 1–50 | 20 | 取得件数 |
| `cursor` | string | — | `nextCursor` の値 |

結果は新しい順。

```json
{
  "results": [
    {
      "postId": "…",
      "timelinePostId": "…",
      "channelId": "…",
      "channelName": "general",
      "threadRootId": null,
      "body": "…",
      "createdAt": "…"
    }
  ],
  "nextCursor": "…"
}
```

`timelinePostId` は、ヒットが返信であってもタイムライン上で表示すべきルートポストの ID。クライアントはこれを `GET /v1/channels/{id}/posts?around=` に渡して該当箇所へ移動する。

全文検索は PGroonga（`pgroonga_text_regexp_ops_v2`）。

### GET /v1/events

| クエリ | 型 | 既定 | 説明 |
|---|---|---|---|
| `after` | `^([0-9]+\|latest)$` | `"0"` | このイベント ID より後を返す。`latest` は履歴を再生せず現在位置から開始 |
| `limit` | integer 1–200 | 100 | 取得件数 |

```json
{
  "events": [
    { "id": "1234", "eventType": "post.created", "channelId": "…", "postId": "…", "threadRootId": null, "createdAt": "…" }
  ],
  "nextAfter": "1234",
  "hasMore": false,
  "resetRequired": false
}
```

- `id` は JavaScript で精度を失わない十進文字列。数値として扱わない。
- `eventType`: `channel.created` `channel.updated` `channel.deleted` `post.created` `post.updated` `post.deleted` `reply.created` `reply.updated` `reply.deleted` `reaction.updated`
- `resetRequired: true` は、指定カーソルが保持期間（30 日）外か、DB 復元でカーソルが最新 ID を追い越した場合。クライアントは表示中データを全再取得して復旧する。

初回接続は必ず `after=latest` を使い、履歴を 0 番から走査しない。イベントの到着通知は Supabase Realtime の `postall:events` トピック（broadcast）で受け、ペイロードにはイベント ID しか載らないため、内容は必ずこのエンドポイントで取り直す。

---

### POST /internal/attachments/reap · POST /internal/events/prune

保守用。`Authorization: Bearer <CRON_SECRET>` を定数時間比較で検証し、成功時は 204。GET でも同じ処理を受け付ける（Vercel Cron の都合）。

| 呼び出し元 | 頻度 |
|---|---|
| Vercel Cron | `reap` 毎日 04:00 UTC / `prune` 毎日 04:15 UTC |
| GitHub Actions（`ops` workflow） | 6 時間ごと。Supabase Free の pause 回避も兼ねる |
