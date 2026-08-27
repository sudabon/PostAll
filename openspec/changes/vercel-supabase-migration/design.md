## Context

PostAll は現在、単一 VPS 上の 4 コンテナ（Nginx / Certbot / Go API / `pg_bigm` 入り PostgreSQL）で稼働し、AWS Cognito と S3 に依存している。本 change はこれを Vercel Hosting と Supabase の 2 サービスへ全面移行する。両対応は行わず、一括で切り替える。

移行の判定にあたって確認した事実は以下。

| 項目 | 事実 |
|---|---|
| Vercel の Go ランタイム | Go Framework Preset が `net/http` サーバをそのまま実行する。ルート `go.mod` を検出し、`$PORT` で待受する。`buildCommand` でエントリポイントを上書きできる |
| Vercel Services | 1 プロジェクト内にフロントエンドと Go バックエンドを同居させ、共有ドメイン上で rewrite により振り分けられる |
| Vercel Functions の上限 | 最大実行時間 300 秒（Pro は 800 秒まで拡張可）、要求／応答ボディ 4.5 MB、バンドル 250 MB |
| Vercel の Go とストリーミング | Node.js と Python の streaming は文書化されているが、**Go は文書化されておらず、`http.Flusher` 非実装の報告がある**。SSE は成立しない前提で設計する |
| Supabase の拡張 | `pgcrypto` は利用可。**`pg_bigm` は提供されず、持ち込みもできない**。PGroonga は公式に提供される |
| Supabase Storage | S3 プロトコル互換。SigV4 の署名付き URL に対応し、`PutObject` / `GetObject` / `HeadObject` / `DeleteObject` を備える |
| Supabase Auth | 非対称署名鍵（ES256）に対応し、`/auth/v1/.well-known/jwks.json` で JWKS を公開する |
| Supabase Realtime | `realtime.send()` を DB トリガーから呼ぶ「Broadcast from Database」がある。private チャネルの購読は `realtime.messages` への RLS で認可する |
| Supavisor | トランザクションモード（ポート 6543）が接続プーラー。接続が要求ごとに割り当て直されるため `LISTEN` は使えず、prepared statement の扱いに注意が必要 |

本 change は **Vercel Hobby プラン**と **Supabase Free プラン**を前提とする。両プランの制約は設計に直接効くため、確認結果を以下に置く。

| 項目 | Vercel Hobby | 影響 |
|---|---|---|
| カスタムドメイン | 50 個/プロジェクト、TLS 自動発行 | `memo.sudabon.com` を引き継げる |
| 関数の最大実行時間 | 300 秒 | — |
| **プロキシ経由のリクエストタイムアウト** | **120 秒（全プラン共通）** | すべての API 応答が 120 秒以内に完了する必要がある |
| 要求／応答ボディ | 4.5 MB | 添付は署名付き URL 直接転送なので影響しない |
| 含まれる使用量 | 呼び出し 100 万/月、Active CPU 4 時間、転送 100 GB | 個人利用では余裕 |
| **Cron** | 本数 100 だが **最短「1 日 1 回」・起動精度 ±59 分** | 添付回収の間隔設計に影響（D13） |
| Git 連携 | **Hobby は Git Organization 所有のリポジトリに接続できない** | `sudabon/PostAll` が個人アカウント所有であることが前提 |
| 利用条件 | 非商用・個人利用のみ | 個人メモアプリなので適合 |

| 項目 | Supabase Free | 影響 |
|---|---|---|
| PGroonga | 公式ドキュメントに**プラン制限の記載なし**（＝利用可と解釈） | 実プロジェクトでの有効化確認を最優先の検証項目に含める |
| Realtime | 利用可。Broadcast、Broadcast from Database、private channel + `realtime.messages` の RLS いずれもプラン制限の記載なし | D5 がそのまま成立 |
| Realtime クォータ | 同時接続 200、メッセージ 200 万/月、256 KB/メッセージ | 個人利用では大幅に余裕 |
| Supavisor | 全プロジェクトで利用可 | D3 がそのまま成立 |
| Storage の S3 互換 | **実プロジェクトで S3 アクセスキーを発行できることを確認済み** | D7 がそのまま成立 |
| データベースサイズ | **500 MB** | 数千〜数万ポストなら収まる。PGroonga 索引は pg_bigm の約 2.3 倍のサイズ |
| Storage 容量 | **1 GB**、1 ファイル最大 50 MB | 25 MiB 添付は通るが、**40 ファイル程度で枯渇する** |
| Egress | 5 GB + キャッシュ 5 GB | — |
| **自動バックアップ** | **無し** | 自前のエクスポートが必須（D14） |
| **プロジェクトの一時停止** | **1 週間 DB アクティビティが無いと pause される** | 個人利用で現実的に踏む。keep-alive が必須（D13） |
| アクティブプロジェクト数 | 2 つまで | 本番のみなら足りる。プレビュー用に別プロジェクトを立てる余地は 1 つ |
| DB 直結の最大接続 | 60（Supavisor 経由は 200 クライアント） | D3 の接続数抑制と整合 |

**利用者は未だ 0 名で、本番にデータが存在しない。** したがって本 change にデータ移送は含まれない。

現行コードのうち移行に有利な性質は 3 つある。

1. **添付は既に署名付き URL によるクライアント直接アップロード**（`backend/internal/blob/s3.go`）で、実体が API サーバを通らない。Vercel の 4.5 MB 上限と衝突しない。`blob.Store` インターフェース（`backend/internal/blob/store.go:5-10`）が切ってあるため差し替え点が 1 箇所に閉じている。
2. **変更通知は既に「通知は合図、実データは `change_events` から取得」という二段構え**になっている。`change_events` は単調増加 ID を持ち、`GET /v1/events?after=` の回収経路を 3 クライアントすべてが実装済み（`frontend/src/hooks/useChangeSync.ts:75-110`、`mobile/lib/state/sync.dart`）。通知経路だけを差し替えればよい。
3. **フロントエンドの API ベース URL の既定値が空文字（同一オリジン相対）**（`frontend/src/state/settings.ts:14`）。`api/openapi.yaml` の `servers` も `- url: /`。API を同一ドメインの `/v1/*` に置く限り、API クライアント本体（`frontend/src/api/client.ts`）は無改修で済み、CORS も不要。

逆に、常駐プロセスを前提とした箇所が 4 つある。SSE のインメモリ購読者管理と `LISTEN postall_events`（`backend/internal/httpapi/event_broker.go`）、起動時 goose マイグレーション（`backend/cmd/postall-server/main.go:23-27`）、15 分間隔の添付リーパー goroutine（`backend/internal/httpapi/server.go:84-88`）、絵文字画像のローカルファイル配信（`backend/internal/httpapi/emojis.go:49-87`）である。

## Goals / Non-Goals

**Goals:**

- Go バックエンドを書き直さずに Vercel 上で稼働させる。ルーティング（23 エンドポイント）、ドメインロジック、sqlc 生成コード、OpenAPI 起点のコード生成パイプラインを維持する。
- 全文検索の外形的な振る舞い（日本語・語の途中一致・大文字小文字非依存・最小 2 文字）を変えずに `pg_bigm` を置換する。
- 変更通知の体感（他クライアントの変更が数秒以内に反映される）を維持したまま、常駐接続を排除する。
- 同一オリジン配信を維持し、CORS を導入しない。
- Supabase Free / Vercel Hobby の制約（自動バックアップ無し、無操作での一時停止、Cron の頻度制限）を、運用の手作業を増やさない形で吸収する。
- ローカル開発と CI の統合テストが移行後も成立する経路を定める。

**Non-Goals:**

- 機能の追加・変更。UI もデータモデルも本 change では変えない（識別子カラムの改名を除く）。
- コンテナ構成との両対応。環境変数による実行環境の切り替えは実装しない。
- マルチリージョン配置、レプリカ、キャッシュ層の導入。
- サインイン UI や PKCE／コールバック方式の再設計。既存の 1 ボタン + PKCE を維持し、移行先で必要な GitHub OAuth provider だけを明示する。
- Realtime を使った「サーバを介さない直接のデータ購読」。クライアントは引き続き HTTP API 経由でのみ読み書きする。
- SSE の Vercel 上での成立可能性の検証。成立しない前提で設計する。

## Decisions

### D1. Vercel Services で 1 プロジェクトに同居させる

`vercel.json` に 2 サービスを定義し、rewrite で振り分ける。

```jsonc
{
  "services": {
    "web": { "root": "frontend/" },
    "api": { "root": "backend/", "buildCommand": "go build -o server ./cmd/postall-server" }
  },
  "rewrites": [
    { "source": "/v1/(.*)",  "destination": { "service": "api" } },
    { "source": "/health",   "destination": { "service": "api" } },
    { "source": "/(.*)",     "destination": { "service": "web" } }
  ]
}
```

**理由**: フロントと API が同一オリジンに乗るため、`VITE_API_BASE_URL` の既定値（空文字）、`openapi.yaml` の `servers: - url: /`、`frontend/src/api/client.ts` がすべて無改修で通る。プロジェクトを分けると別ドメインになり、CORS ミドルウェアの新規実装（現在は存在しない）とクライアント設定の変更が連鎖する。

**却下した案**: フロントを Vercel、API を Cloud Run 等の別サービスへ。→ 「Vercel + Supabase のみ」という前提に反する。

**注意点**: Go の Framework Preset が自動検出するエントリポイントは `main.go` / `cmd/api/main.go` / `cmd/server/main.go` で、本リポジトリの `cmd/postall-server/main.go` は該当しない。`buildCommand` で明示する。`go.mod` はサービスルート（`backend/`）にあり、この配置のままでよい。

**Services が Hobby で使えなかった場合のフォールバック**: フロントエンドと API を 2 つの Vercel プロジェクトに分け、フロント側の `vercel.json` で `/v1/*` を API プロジェクトへ **rewrite（サーバー側プロキシ）**する。rewrite はブラウザから見たオリジンを変えないため、CORS は依然として不要で、クライアントも無改修のまま。Hobby のアクティブプロジェクト上限（200）にも余裕がある。プロキシ経由のタイムアウト 120 秒はどちらの構成でも同じ。

### D2. Go サーバは書き直さず、待受アドレスだけ変える

`cmd/postall-server/main.go` の `LISTEN_ADDR`（既定 `:8080`）を、`PORT` が設定されていればそちらを優先する形にする。`http.Handler` の構成、ミドルウェア（`requestIDMiddleware` → `auth.Middleware`）、oapi-codegen 生成のルーティングはそのまま。

**理由**: Vercel の Go ランタイムは `net/http` サーバをそのまま動かす。ハンドラを 23 個の個別 Function へ分割する必要はなく、分割すればコード生成パイプラインとルーティングの単一性を失う。

**副次的な修正**: `main.go` は `httpapi` の `Close()` を呼んでいない（`backend/internal/httpapi/server.go:136-146` が未使用）。常駐処理を取り除く過程でこの経路を整理する。

### D3. DB 接続は Supavisor トランザクションプーラー経由に固定する

- 接続文字列: Supavisor のトランザクションモード（ポート 6543）。
- `pgxpool` を明示設定する（現状は `pgxpool.New` に設定を渡していない。`backend/internal/httpapi/server.go:61`）。`MaxConns` を 1〜2 に抑え、`MaxConnIdleTime` を短くする。
- pgx の prepared statement キャッシュを無効化する（`default_query_exec_mode=exec` または接続文字列で `statement_cache_capacity=0`）。

**理由**: サーバーレスではインスタンスが水平に増える。pgx の既定 `MaxConns = max(4, NumCPU)` のままだと、同時実行数 × 4 本以上の接続がデータベースの上限を即座に食い潰す。トランザクションモードは接続を要求ごとに割り当て直すため、名前付き prepared statement が別セッションで見つからない事故が起きうる。

**却下した案**: セッションモード（ポート 5432）やダイレクト接続。→ 接続数モデルがサーバーレスと噛み合わない。

**例外**: マイグレーションの適用（D9）はダイレクト接続またはセッションモードを使う。DDL とアドバイザリロックがトランザクションモードと相性が悪いため。

### D4. 全文検索は PGroonga の regexp ops で置換する

- `create extension pgroonga`
- 索引を `posts using gin (lower(body) gin_bigm_ops)` から `posts using pgroonga (body pgroonga_text_regexp_ops_v2)` へ差し替える。
- クエリの `and lower(p.body) like likequery(lower($1))` を、アプリ側で `%` `_` `\` をエスケープした `LIKE '%…%'` パターンに置き換える（`backend/internal/store/queries/search.sql:13,32`）。エスケープは Go 側のヘルパに切り出し、単体テストを付ける。

**理由**: `pgroonga_text_regexp_ops_v2` は `LIKE '%…%'` を索引で加速する。演算子もセマンティクスも `LIKE` のまま変わらないため、**検索結果が移行前後で一致する**。`likequery()` は pg_bigm がパターン生成とエスケープを担っていた関数であり、その責務だけをアプリ側へ引き取る形になる。

**却下した案**:
- PGroonga の全文検索 ops（`&@~`）。→ AND/OR/除外が書けて高速だが、トークナイザ依存になり「語の途中に一致する」という既存シナリオの振る舞いが変わる。仕様側の書き換えも必要になる。
- `pg_trgm` + `gin_trgm_ops`。→ 3-gram のため日本語 2 文字の検索が索引に乗らない。`api/openapi.yaml` の `q: minLength: 2` および `backend/internal/search/service.go:50-52` の最小 2 文字と噛み合わない。
- `tsvector` + 形態素解析。→ Supabase に日本語辞書がなく、分かち書きの成否に依存しない要件を満たせない。

**索引のサイズ**: PGroonga の索引は対象テキストを索引内にも保持するため、pg_bigm の約 2.3 倍のサイズになる。Supabase Free のデータベース上限は 500 MB で、本文平均 1 KB・数万ポストなら索引込みでも十分収まる。上限に近づいた場合はプランの引き上げが唯一の選択肢になる。

**索引経路の検証**: 検索結果の一致テストでは `enable_seqscan = off` にして PGroonga 索引の利用を強制し、`EXPLAIN` が `posts_body_pgroonga` を使うことを先に確認する。`%`、`_`、`\\` を含む検索語も、索引あり／なしの両経路で同じ結果になることを検証する。

**ロールバック**: 00008 の Down は `pg_bigm` と `posts_body_bigm` を復元してから PGroonga を外す。`pg_bigm` を提供しない Supabase では Down 全体を失敗させ、トランザクションにより PGroonga 索引を残す。索引を一つも持たない中間状態へは遷移させない。

### D5. 変更通知は Supabase Realtime Broadcast from Database へ置換する

現行のトリガー関数（`backend/migrations/00006_search_events.sql:31-43`）を、`pg_notify` から `realtime.send()` へ差し替える。

```sql
create or replace function postall_notify_change_event() returns trigger
language plpgsql
as $$
begin
    perform realtime.send(
        jsonb_build_object('id', new.id),  -- 合図のみ。本文は載せない
        'change',
        'postall:events',
        true                                -- private
    );
    return new;
end;
$$;
```

クライアントは `postall:events` トピックを購読し、通知を受けたら既存の `GET /v1/events?after=<lastId>` で差分を回収する。`GET /v1/events/stream` と `backend/internal/httpapi/event_broker.go` は削除する。

**理由**:
- `change_events` テーブルと記録トリガー群（`00006_search_events.sql:46-140`）をそのまま温存できる。差分は通知関数 1 本。
- 常駐接続が Vercel ではなく Supabase 側に張られるため、Vercel の実行時間上限とインメモリ購読者管理の問題が同時に消える。
- ペイロードを「イベント ID のみ」に絞ることで、Realtime 経路が認可を迂回した情報漏洩経路にならない（`sync-and-storage` の「通知に本文を含めない」）。実データは従来どおり認可済みの HTTP API からしか出ない。
- クライアント側の差分回収ロジック（取りこぼし補填・順序保証・重複排除）が既に完成しており、そのまま使える。

**認可**: private チャネルとし、`realtime.messages` の SELECT は `realtime.topic() = 'postall:events' and extension = 'broadcast'` を満たす認証済みユーザーだけに許可する。他の Realtime トピックはこのポリシーで購読可能にしない。クライアントは Supabase Auth のアクセストークンで Realtime へ接続する。

**トークン更新と再接続**: Realtime ヘルパへ固定アクセストークンではなく非同期の token provider を渡す。接続・再接続のたびに既存のセッション更新経路から最新トークンを取得し、購読失敗時はポーリングへ退避しながら指数バックオフで Realtime を再接続する。フロントエンドは既存の固定文字列引数も受理し、iOS は既存の `PostAllApi.watchChangeSignals()` を変更せず、別の任意 capability で購読状態を `sync.dart` へ伝えることで公開 API の互換性を保つ。ポーリング中はデータ取得が成功しても接続表示を `degraded` のままにする。

**通知失敗の観測**: DB 書き込みを Realtime 障害でロールバックしない best-effort 方針は維持するが、トリガーの例外ハンドラは `raise warning` で SQLSTATE とメッセージを記録する。無音の `when others then null` は使わない。

**初期位置と保持期間**: 新しいクライアントセッションは `GET /v1/events?after=latest` で現在のイベント ID だけを取得し、表示中データを通常の一覧 API から1回読み直す。これにより、イベント数に比例して `after=0` のページを走査する初回処理を廃止する。通常の数値カーソルは後方互換のため維持する。

`change_events` は30日保持とし、共有シークレットで保護した `/internal/events/prune` を既存の定期保守から実行する。全件削除すると現在位置を失うため、最新の1行は期間を超えてもウォーターマークとして残す。整理処理が実際に削除した最大 ID は単一行の `change_event_retention.pruned_through` に同じSQL文で記録し、トランザクション順序による通常の identity 欠番と保持期限による欠落を区別する。数値カーソルがこの削除済み範囲より前、またはDB復元後の最新 ID より先を指す場合、API はイベントを部分的に返さず、最新 ID と任意フィールド `resetRequired: true` を返す。Web と iOS は表示中データを全再取得してその最新 ID から同期を再開する。30日以内の通常再接続は従来どおりイベント単位で反映する。

**却下した案**:
- Postgres Changes（`change_events` テーブルの変更を直接購読）。→ Supabase 自身が Broadcast の方がスケールすると案内しており、また行の内容がそのままクライアントへ届くため payload の統制が効かない。
- ポーリングのみ。→ 追加依存はゼロだが、反映が遅れ、アイドル時も要求が発生し続ける。Realtime が使える以上、退化させる理由がない。
- Vercel 上で SSE を維持。→ Go ランタイムの `http.Flusher` 非対応の報告があり、成立しても最大実行時間で必ず切断される。

**フォールバック**: Realtime へ接続できない場合、クライアントは `GET /v1/events?after=` の定期取得へ退避する（`sync-and-storage` の「通知経路が使えない場合」）。この経路は既に実装されている。

### D6. 認証は Supabase Auth へ移行し、verifier は構造を残して差し替える

`backend/internal/auth/verifier.go` の骨格 — JWKS の取得、`kid` によるキー選択、プロセス内キャッシュ、未知 kid の遅延リフレッシュ、`singleflight` による重複抑止、ネガティブキャッシュとクールダウン — はそのまま活かす。変えるのは 3 点。

| 項目 | Cognito | Supabase Auth |
|---|---|---|
| JWKS URL | `https://cognito-idp.{region}.amazonaws.com/{poolId}/.well-known/jwks.json` | `{SUPABASE_URL}/auth/v1/.well-known/jwks.json` |
| 署名方式 | RS256（RSA 鍵のみ受理） | **ES256**（ECDSA P-256）。鍵の型判定を差し替える |
| クレーム検証 | `token_use` で id/access を分岐し `aud` / `client_id` を照合 | `iss` = `{SUPABASE_URL}/auth/v1`、`aud` = `authenticated`、`role` = `authenticated` |

ユーザー識別子は引き続き `sub` を使う（`backend/internal/auth/middleware.go:49`）。`users.cognito_sub` カラムはプロバイダ非依存の名前（`auth_subject`）へ改名する。

**コールドスタート時の JWKS 取得**: サーバーレスではインスタンスごとに初回の認証要求で JWKS のフェッチが走る。Supabase の JWKS エンドポイントはエッジで 10 分キャッシュされるため実害は小さいが、取得タイムアウト（現行 10 秒）を短くし、失敗時に 5xx を返す経路を確認する。

**毎リクエストの users upsert**: 現行は全要求で `insert ... on conflict do update set updated_at = now()`（`backend/internal/store/queries/queries.sql:1-5`）を実行しており、要求ごとに書き込みトランザクションが 1 回発生する。プーラー経由ではこれがレイテンシと接続消費に直結するため、**`select` を先に試し、不在時のみ `insert` する**形へ変える。`updated_at` の毎回更新は落とす。

**クライアント側**: `frontend/src/auth/pkce.ts`（手書き PKCE）と `mobile/lib/auth/cognito.dart` を Supabase Auth のフローへ書き換える。`postall://auth/callback` は Supabase の Redirect URL 許可リストへ登録して維持し、Electron の `app.setAsDefaultProtocolClient('postall')`（`electron/main.mjs:202-214`）と iOS の `Info.plist` は変更しない。トークンの保管方式（Electron: `safeStorage`、iOS: Keychain、ブラウザ: 非永続）も変更しない。

**サインイン方式**: 既存の 1 ボタン UI を維持し、GitHub OAuth を採用する。3 クライアントの `/auth/v1/authorize` URL に `provider=github` を必ず含め、既存の URL builder 呼び出しは既定値 `github` でソース互換にする。ローカル設定は `[auth.external.github]` の client ID / secret を環境変数参照で有効化し、本番は Supabase Dashboard へ同じ GitHub OAuth App を登録する。

**招待制**: Supabase Auth の新規サインアップと email signup は無効化する。初回ログイン前に管理画面で GitHub の検証済みメールアドレスと同じ確認済みユーザーを作成し、OAuth の自動 identity linking で既存ユーザーへ結び付ける。これにより未登録の GitHub ユーザーは JWT を取得できず、API の既存の「authenticated ロールのみ」という認可モデルを維持できる。

### D7. オブジェクトストレージは S3 互換エンドポイントで差し替える

`backend/internal/blob/s3.go` の `aws-sdk-go-v2` をそのまま使い、エンドポイントと資格情報を Supabase Storage の S3 互換エンドポイントへ向ける。`PresignPut`（15 分）、`PresignGet`（5 分、`ResponseContentDisposition` 付き）、`Head`、`Delete` の 4 操作はいずれも Supabase Storage がサポートする。

**理由**: SigV4 の署名付き URL に対応しているため、`blob.Store` の実装だけが変わり、`internal/attachment/service.go` のアップロード 3 段階フロー（開始 → 直接 PUT → 完了通知 + `Head` 検証）も、クライアントのアップロード実装（`frontend/src/lib/upload.ts`）も、`api/openapi.yaml` の `StartUploadResponse`（url + headers）も原則そのまま通る。

**`ContentLength` の署名**: `PresignPut` は `ContentLength` を署名へ含めている（`s3.go:40-47`）。Supabase Storage の SigV4 実装は `content-length` を署名可能ヘッダとして扱い、canonical request を実リクエストのヘッダ値から組むため、**署名した値と異なる値を送れば署名不一致で拒否される**。この点は現行どおり機能する。

ただし Supabase Storage は「宣言された `Content-Length` と実際のボディバイト数が一致するか」を明示的には検証していない（宣言値は RLS メタデータ用として扱われ、実サイズの上限強制は別経路）。したがって **25 MiB 上限の担保を署名だけに頼らず、完了通知時の `Head` によるサイズ検証（`internal/attachment/service.go:107-113`、既に存在する）を必ず残す**。

なお AWS SDK v3 系は既定で `host` のみを署名するため、`content-length` を署名対象に含めるには明示指定が要る。Go の `aws-sdk-go-v2` で現行の署名対象がどうなっているかを実装時に確認する。

**却下した案**: Supabase Storage のネイティブ API（`createSignedUploadUrl`）。→ URL の形が S3 と異なり、`StartUploadResponse` スキーマとクライアント 3 実装の変更が連鎖する。S3 互換で済むならそちらが安い。

### D8. 絵文字画像は Storage へ移し、既存エンドポイントは 302 で返す

- `emoji-sync` が `emoji/` の png を Supabase Storage の絵文字バケットへアップロードし、DB には従来どおり `shortcode` / `storage_key` / `checksum` のみを記録する（スキーマ変更なし）。
- `GET /v1/emojis/{shortcode}/image` は認可を検証し、`If-None-Match` が DB の checksum と一致すれば 304 を返す。一致しなければ署名付き GET URL へ 302 リダイレクトする。
- `backend/internal/httpapi/emojis.go` のローカル FS 配信（`os.OpenRoot` / `http.ServeContent`）を削除する。
- `emoji-sync` は DB の checksum が一致していても Storage の `Head` を確認し、実体が無ければ再アップロードする。DB 復元後に空の Storage を自己修復できるようにする。
- 304 判定は Storage の `Head` より後に行う。302 の `Cache-Control` は署名付き URL の 5 分より十分短い 60 秒にし、キャッシュ境界で期限切れ URL を再利用しない。

**理由**: 実体を関数バンドルへ同梱すると、`emoji/` が `backend/` の外にあるため取り込み設定が必要になり、絵文字の追加のたびに API の再デプロイが要る。Storage へ置けば `emoji-sync` の実行だけで反映される。302 にすることで画像バイトが関数を通らない。

**認可の維持**: フロントエンドは `<img src>` ではなく認可付き `fetch` → `blob()` で読み込んでいる（`frontend/src/api/client.ts:122`）。302 の追随先は署名付き URL で `Authorization` を必要とせず、ブラウザはクロスオリジンのリダイレクトで `Authorization` ヘッダを落とすため、そのまま成立する。

**却下した案**: バケットをパブリック読み取りにして `imagePath` に CDN URL を返す。→ 最も安いが、絵文字画像が無認可で読める状態になる。`emoji-reactions` の認可要件に反する。

**付随事項**: `emoji/` には `.gif` が 9 件あるが、登録処理は `.png` のみを対象としており（`backend/internal/emoji/service.go:55-58`）カタログに載っていない。本 change ではこの挙動を変えない。

### D9. マイグレーション・絵文字同期・添付回収を実行経路から追い出す

| 処理 | 現在 | 移行後 |
|---|---|---|
| goose マイグレーション | プロセス起動ごと（`cmd/postall-server/main.go:23-27`） | 独立した手動 GitHub Actions。Session プール接続で明示実行する |
| 絵文字同期 | 手動 CLI（`emoji-sync` サブコマンド） | 手動マイグレーション成功後のジョブ。CLI は残す |
| Vercel デプロイ | Git 連携による自動実行 | 独立した手動 GitHub Actions。未適用マイグレーションがあれば読み取り検査で拒否する |
| 添付リーパー | 15 分間隔の常駐 goroutine（`internal/httpapi/server.go:84-88`） | Vercel Cron が叩く内部エンドポイント |

添付リーパーの内部エンドポイントは共有シークレットで保護する。`Reap` の本体（`internal/attachment/service.go:197-225`）は冪等で 1 バッチ 100 件の上限を持つため、ロジックはそのまま流用できる。二重起動に対しては、対象マークのクエリ（`internal/store/queries/attachments.sql:49-61`）が既に処理済みを除外するため不整合は生じない。

Vercel の全ブランチ自動デプロイは `vercel.json` の `git.deploymentEnabled: false` で停止する。マイグレーションとデプロイは同じ Git ref を選んで別々に手動実行し、前者から後者を自動起動しない。両 workflow は共通の `production-release` concurrency group を使い、相互に同時実行しない。デプロイの `migrate-check` はDBを変更せず、未適用版があれば失敗するため、運用者はマイグレーションを先に完了させる。これによりDDL失敗時にアプリだけが先行する競合を防ぎつつ、2処理の実行責務を分離する。

**却下した案**: Supabase の `pg_cron` から回収を駆動する。→ S3 互換 API の呼び出しが DB からはできず、Go のロジックを SQL へ書き直すことになる。

### D10. `vercel.json` で Nginx のキャッシュ指示と SPA フォールバックを再現する

`infra/nginx/templates/default.conf.template:63-83` が持っていた挙動を移す。

| 対象 | 指示 |
|---|---|
| `/assets/*`（内容ハッシュ付き） | `Cache-Control: public, max-age=31536000, immutable` |
| `/sw.js` | `Cache-Control: no-cache`、`Service-Worker-Allowed: /` |
| `/manifest.webmanifest` | `Cache-Control: no-cache` |
| その他のパス | `index.html` へフォールバック、`Cache-Control: no-cache` |

`/v1/*` と `/health` は D1 の rewrite で API サービスへ向くため、SPA フォールバックより先に評価される。Service Worker 側の除外規則（`frontend/vite.config.ts:35,41-47`、`frontend/src/pwa/rules.ts`）はパス基準なので変更不要。

### D11. ローカル開発とテストの経路

- **ローカル開発**: `vercel dev` で web と api を同時に起動する。データベースは Supabase CLI のローカルスタックを使う。
- **統合テスト**: `backend/internal/testutil/postgres.go` の testcontainers を、`pgroonga` を含む PostgreSQL イメージへ切り替える（PGroonga は公式イメージを配布している）。テストが検証するのは索引と `LIKE` の組み合わせであり、Supabase の他機能には依存しない。
- **Realtime に依存するテスト**: `realtime.send()` は Supabase 固有のため、testcontainers 上では通知関数をスタブに差し替える。検証対象は「`change_events` に行が入ること」と「`GET /v1/events?after=` が正しく返すこと」に絞る。通知経路そのものは手動確認とする。
- **SSE プロキシ検証ハーネス**（`infra/tests/`、`infra/scripts/verify-sse-proxy.sh`、`Makefile` の `test-sse-proxy`）は削除する。

### D12. カットオーバーは停止を伴う一括切替とする

個人利用のメモアプリであり、書き込みを止められる。二重書き込みや同期の仕組みは作らない。詳細は「Migration Plan」に記す。

### D13. 定期実行は GitHub Actions から叩き、keep-alive を兼ねさせる

Vercel Hobby の Cron は最短 1 日 1 回・起動精度 ±59 分。一方 Supabase Free は 1 週間 DB アクティビティが無いとプロジェクトが pause される。この 2 つを 1 本の仕掛けで解く。

- 添付回収と30日を超えた変更イベント整理の内部エンドポイント（共有シークレット保護）を、**GitHub Actions の `schedule` から 6 時間ごとに叩く**。
- 回収処理は必ず DB へ問い合わせるため、この定期実行がそのまま Supabase の keep-alive になる。
- Vercel Cron も日次で同じエンドポイントに向けて設定し、Actions が止まった場合の二重化とする。エンドポイントは冪等なので二重起動は無害。

**理由**: エンドポイントは呼び元を問わないため、Vercel Cron でも GitHub Actions でも実装は同じ 1 本。Actions の `schedule` は無料で分単位の指定ができ、Hobby の日次制限も pause 問題も同時に解消する。専用の keep-alive エンドポイントを別に作るより、既に必要な処理へ相乗りする方が動く部品が減る。

**却下した案**:
- Vercel Cron のみ（日次）。→ pause の回避には「1 日数回の DB アクティビティ」が推奨されており、日次 1 回では心許ない。回収の遅延も 1 日単位になる。
- Supabase の `pg_cron` で keep-alive。→ DB 内で完結するため pause 判定の「ユーザー DB アクティビティ」に数えられるか不確かで、S3 互換 API を呼べないため回収処理も担えない。
- Pro プランへの引き上げ。→ 本 change の前提（Hobby / Free）に反する。将来 Pro へ上げれば Vercel Cron を分単位にでき、この仕掛けは単純化できる。

**注意**: GitHub Actions の `schedule` は指定時刻ちょうどには起動せず、混雑時は遅延・スキップされる。回収も keep-alive も遅延に強い処理なので許容する。

### D14. バックアップは GitHub Actions からのエクスポートで確保する

Supabase Free には自動バックアップが無く、pause 後の復帰可能期間についても公式の記述に食い違いがある（Studio から 1 年とする記述と、90 日とする Discussion が併存）。プラットフォーム側の保持を当てにしない。

- GitHub Actions の `schedule` で **日次** `supabase db dump --data-only --schema public --use-copy` を実行し、gzip 圧縮後に `DUMP_PASSPHRASE` secret を使って GPG の AES-256 対称暗号で暗号化する。goose 適用済みの空 DB へ戻すため `public.goose_db_version` は除外し、公開リポジトリへ平文ダンプをアップロードしない。
- 暗号化済みファイルだけを Actions のアーティファクトとして 30 日保持する。1 件を 10 MiB 以下に制限し、超えた場合はアップロードせずジョブを失敗させる。日次実行分の保持量は最大約 300 MiB になる。`workflow_dispatch` の手動実行分も容量へ加算されるため、総量の停止境界は次項の `$0` 予算で担保する。
- GitHub の Actions storage 予算を `$0` かつ上限到達時に停止する設定にし、アカウント内の他リポジトリや Packages と無料枠を共有していても追加課金を許可しない。この設定はリポジトリ外の手動運用項目として README に残す。
- 失敗はワークフローの失敗として表面化させ、直前に成功したダンプは消さない。
- 添付の実体（Storage）は本 change ではエクスポート対象に含めない。数が少なく、失われても本文は残るため。将来 Storage の使用量が増えたら見直す。

**理由**: 「運用対象をアプリケーションコードだけにする」という本 change の動機に対し、手動バックアップは真っ向から反する。自動化されていないバックアップは無いのと同じ。圧縮してから暗号化することで保持量を抑え、GitHub とは別の有料ストレージを追加せず、公開アーティファクトからの情報漏洩も防ぐ。

**却下した案**:
- Supabase の pause 時に取得されるバックアップに頼る。→ 取得のタイミングを制御できず、Free ではダッシュボードからダウンロードできないという記述もある。
- Supabase Storage の非公開バケットへ置く。→ 非公開にはできるが DB と同じ障害ドメインになり、1 GB の無料枠を添付と競合する。
- 外部 S3 へ置く。→ 障害分離は最良だが、追加サービスと従量課金が発生しうるため「追加費用なし」という条件に反する。

### D15. テスト専用の変更合図は本番で登録しない

フロントエンド E2E が使う `postall:change-signal` のグローバルイベント受け口は、Vite の development / test mode でだけ登録する。本番ビルドではリスナー自体を含めず、通常の Supabase Realtime 経路だけを使う。E2E の既存モック方式とアプリの公開 API は変更しない。

## Risks / Trade-offs

- **Vercel の Go ランタイムが本アプリの構成で期待どおり動かない** → 移行作業の最初に、`vercel.json` と最小限の `PORT` 対応だけを入れた状態で `/health` が応答することを確認する。ここが通らなければ以降の作業に意味がないため、最優先の検証項目とする。
- **Vercel Services が Hobby プランで使えない** → D1 のフォールバック（2 プロジェクト + rewrite プロキシ）へ切り替える。クライアント側は同一オリジンのまま変わらないため、影響は `vercel.json` の構成のみ。
- **PGroonga が Supabase Free で有効化できない** → 公式ドキュメントにプラン制限の記載は無いが、「Free で使える」と明記したソースも無い。プロジェクト作成直後に `create extension pgroonga` を試す（tasks 1.2）。使えない場合、選択肢は ①Pro へ引き上げる ②`pg_trgm` に落として最小検索文字数を 3 文字へ引き上げる（`full-text-search` の要件変更が必要）③索引なしの `LIKE` で当面しのぐ、の 3 つ。**この判定は他のすべての作業より前に済ませる。**
- **Supabase Free のプロジェクトが pause される** → D13 の 6 時間ごとの定期実行で回避する。それでも pause された場合はダッシュボードから Resume する。復帰可能期間について公式の記述が食い違っているため、D14 のエクスポートを最後の保険とする。
- **Supabase Free のバックアップが無い** → D14 で日次エクスポートを自動化する。復旧時に失われるのは直近のエクスポート以降の変更のみ。
- **暗号化バックアップが 10 MiB を超える、または Actions の無料枠を使い切る** → 新しい Artifact は保存せずジョブを失敗させ、直前に成功した暗号化ダンプを残す。通知を受けて保持期間短縮または外部ストレージへの移行を判断する。追加課金で自動継続はしない。
- **Storage 1 GB の上限** → 25 MiB の添付なら 40 ファイル程度で枯渇する。個人メモの添付としては当面足りる見込みだが、使用量の監視を運用メモに残す。上限に近づいたら Pro への引き上げか、添付の最大サイズ引き下げを検討する。
- **データベース 500 MB の上限** → PGroonga の索引は pg_bigm の約 2.3 倍のサイズになる。本文中心のメモなら数万ポストまで収まる見込み。こちらも監視対象とする。
- **Supavisor のトランザクションモードで prepared statement 起因のエラーが出る** → sqlc 生成コードは pgx の `Query`/`Exec` を通るため、実行モードの設定で対処できる。統合テストを PgBouncer のトランザクションモードに対して一度通す。
- **Supabase Storage の `Content-Length` 署名と実バイト数の不一致** → 署名の一致は検証されるが、宣言値と実バイト数の整合は保証されない。完了通知時の `Head` によるサイズ検証を必ず残す（D7）。
- **Realtime の RLS 設定を誤ると通知が届かない、あるいは無認可で届く** → payload をイベント ID のみに絞ってあるため、仮に購読が漏れても本文は漏れない。届かない場合はポーリングへ退避するため機能停止にもならない。設定は「認証済みのみ購読可」「匿名は購読不可」の 2 ケースを手動で確認する。DB 側の `private` フラグとクライアント側チャンネルの `private` 設定が一致していないと動作しない点に注意する。
- **Vercel Hobby の非商用制限と Git Organization 制限** → 個人利用のメモアプリであり非商用の条件を満たす。`sudabon/PostAll` が個人アカウント所有であることが前提で、Organization へ移すと Hobby では接続できなくなる。
- **GitHub Actions の `schedule` が遅延・スキップされる** → 添付回収も keep-alive も遅延に強い。Vercel Cron の日次実行を二重化として併置する。
- **コールドスタートの遅延** → 初回要求で JWKS フェッチとプール確立が走る。Supabase Free は Nano（Shared CPU / 0.5 GB）でもあり、個人利用のアクセス頻度では体感に影響しうる。機能上の問題ではないため許容する。
- **要求ごとの `users` 参照が増える** → D6 で `select` 優先へ変えることで書き込みは消えるが、読み取りは残る。プーラー経由での往復が 1 回増える。許容する。
- **ロールバック先が消える** → コンテナ構成を削除するため、切り替え後に元へ戻すには削除したファイルを git から復元し、VPS を再構築する必要がある。ただし本番にデータが無いため、失うものは構成のみ。DNS を切り替えるまでは旧環境が生き続ける。
- **PGroonga の索引はクラッシュ耐性がない**（GIN と異なり、破損時は REINDEX が必要）→ 索引の再作成手順を運用メモに残す。

## Migration Plan

**本番にデータが存在しないため、データ移送は行わない。** 段階を 4 つに分ける。

**Phase 0: 前提の検証（ここが通らなければ設計を見直す）**

1. Supabase プロジェクトを Free プランで作成し、`create extension pgroonga` と `create extension pgcrypto` が通ることを確認する。
2. Supabase Storage のバケットを作成し、S3 アクセスキーを控える（Free で発行できることは確認済み）。
3. Vercel プロジェクトを Hobby で作成し、`vercel.json` の `services` 定義と `PORT` 対応だけを入れた状態で `/health` が応答することを確認する。Services が使えなければ D1 のフォールバックへ切り替える。

**Phase 1: バックエンドのサーバーレス適合**

4. マイグレーションを書き換える（PGroonga、`realtime.send()`、識別子カラムの改名）。
5. 起動時マイグレーションを削除し、独立した手動 GitHub Actions へ移す。
6. `pgxpool` の明示設定と Supavisor 接続へ切り替える。
7. SSE エンドポイントと `event_broker` を削除する。
8. 添付リーパーを Cron エンドポイントへ移す。
9. `blob.Store` を Supabase Storage 実装へ差し替える。
10. 絵文字配信を Storage + 302 へ移し、`emoji-sync` を手動マイグレーション後のジョブへ移す。
11. 検索クエリを PGroonga 用に書き換え、統合テストを PGroonga 入りイメージで通す。
12. 認証 verifier を Supabase Auth へ差し替える。

**Phase 2: クライアントの追随**

13. `api/openapi.yaml` から `GET /v1/events/stream` を削除し、`make generate` で 3 クライアントの生成物を更新する。
14. フロントエンド、iOS、Electron の認証・Realtime 購読・設定項目を書き換え、初期同期を最新ウォーターマーク開始へ変更する。

**Phase 3: 公開と撤去**

15. `vercel.json` にキャッシュ指示と SPA フォールバックを追加する。
16. マイグレーション + 絵文字同期と Vercel デプロイを別々の手動 Actions にし、日次エクスポート・6 時間ごとの回収とイベント整理を定期 Actions に追加する。
17. 手動マイグレーション後に手動 Vercel デプロイを実行して本番昇格し、`memo.sudabon.com` の DNS を切り替える。切替前に TTL を短くしておく。
18. サインイン、投稿、添付のアップロードとダウンロード、検索、他クライアントへの変更反映、絵文字リアクションを 3 クライアントで確認する。
19. `infra/`、`backend/Dockerfile`、`Makefile` の `test-sse-proxy` を削除し、`README.md` を書き直す。
20. AWS の Cognito ユーザープールと S3 バケット、および旧 VPS を破棄する。

**ロールバック**: 17 以前であれば DNS を切り替えないだけで旧環境が生き続ける。17 以降で問題が出た場合は DNS を戻す。19 と 20 は動作確認が済むまで実行しない。

## Open Questions

すべて解決済み。決定内容は以下。

| 論点 | 決定 | 反映先 |
|---|---|---|
| Vercel のプラン | **Hobby**。Cron が日次・±59 分になるため、定期実行は GitHub Actions を主、Vercel Cron を従とする | D13 |
| Supabase のプラン | **Free**。PGroonga と Realtime はプラン制限の記載が無く利用可と判断。ただし Phase 0 で実地確認する。自動バックアップが無いため日次エクスポートを自動化し、無操作 pause を定期実行で回避する | D13、D14、Phase 0 |
| 既存ユーザーの移行 | **不要**（利用開始前でデータが無い）。データ移送・`sub` 対応付け・既存データへの索引作成をすべて削除した | Migration Plan |
| ドメイン | **`memo.sudabon.com` を引き継ぐ**。Hobby でもカスタムドメインは 50 個まで使え、TLS は自動発行。iOS の既定 API ベース URL（`mobile/lib/state/settings.dart:15`）は変更不要 | Phase 3 |
| `PresignPut` の `ContentLength` 署名 | **署名の一致は検証される**（Supabase Storage の SigV4 実装が `content-length` を署名可能ヘッダとして扱う）。ただし宣言値と実バイト数の整合は保証されないため、完了時の `Head` 検証を必ず残す | D7 |
| Supabase Auth のサインイン方式 | **GitHub OAuth**。既存の 1 ボタン + PKCE を維持し、signup を無効化したうえで、確認済みの既存ユーザーへ同一メールの GitHub identity をリンクする | D6 |
| DB ダンプの保管 | **gzip + GPG 暗号化済み Artifact**。30 日保持、1 件 10 MiB 上限、Actions storage 予算 `$0`。上限時はバックアップ失敗を許容し、追加課金しない | D14 |

Supabase Free での Storage の S3 アクセスキー発行は、実プロジェクトで発行できることを確認済み。D7（`aws-sdk-go-v2` をそのまま使い、エンドポイントと資格情報だけ差し替える）がそのまま成立する。

残る未確認事項は 1 つで、Phase 0 で判定する。

- **Vercel Services が Hobby プランで利用できるか**。使えなければ D1 のフォールバック（フロント / API を 2 プロジェクトに分け、フロント側 `vercel.json` の rewrite で `/v1/*` を API プロジェクトへプロキシする）へ切り替える。ブラウザから見たオリジンは変わらないため、CORS 不要・クライアント無改修という性質は保たれる。
