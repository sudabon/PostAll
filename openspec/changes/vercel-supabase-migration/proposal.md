## Why

現在の PostAll は単一 VPS 上の 4 コンテナ（Nginx / Certbot / API / PostgreSQL）で動いている。この構成は、TLS 証明書の更新監視、PostgreSQL のバックアップ、`pg_bigm` を焼き込んだ独自 PostgreSQL イメージの追随、ホストの OS 更新という運用作業を恒常的に要求する。個人利用のメモアプリに対してこの運用コストは釣り合わない。

Vercel Hosting と Supabase へ載せ替えれば、TLS・CDN・デプロイは Vercel が、PostgreSQL・認証・オブジェクトストレージ・リアルタイム配信は Supabase が引き受ける。運用対象はアプリケーションコードだけになる。

## What Changes

- **BREAKING** 実行環境を Vercel + Supabase の 2 サービスへ全面移行し、コンテナ構成（`infra/`）を廃止する。両対応は行わない。
  - Go バックエンドは Vercel Services の Go サービスとして、`net/http` サーバのまま稼働する。フロントエンドの静的アセットと同一プロジェクト・同一ドメインに同居し、`/v1/*` を API サービスへ rewrite する。同一オリジンが維持されるため CORS は不要のまま。
  - Nginx / Certbot / PostgreSQL コンテナ、`pg_bigm` 入り PostgreSQL イメージ、SSE プロキシ検証ハーネスを削除する。Nginx が担っていたキャッシュヘッダと SPA フォールバックは `vercel.json` で再現する。
- **BREAKING** 認証を AWS Cognito から **Supabase Auth** へ移行する。
  - バックエンドの JWT 検証は Supabase の JWKS（`/auth/v1/.well-known/jwks.json`, ES256）を参照するよう差し替える。JWKS キャッシュ・未知 kid の遅延リフレッシュ・ネガティブキャッシュという既存の検証構造はそのまま使う。
  - 3 クライアント（PWA / Electron / iOS）の OAuth フローを Supabase Auth へ書き換える。`postall://auth/callback` のカスタムスキームは Supabase の Redirect URL 許可リストへ登録して維持する。
  - `users.cognito_sub` を認証プロバイダ非依存の名前へ改める。
- **BREAKING** 全文検索の索引を **`pg_bigm` から PGroonga** へ置換する。Supabase は `pg_bigm` を提供しない。`pgroonga_text_regexp_ops_v2` を使うことで、現行の `LIKE '%語句%'` 部分一致セマンティクス（日本語・語の途中一致・最小 2 文字）を変えずに済む。`likequery()` に依存する 2 クエリを書き換える。
- **BREAKING** 変更通知を SSE から **Supabase Realtime Broadcast** へ置換し、`GET /v1/events/stream` を廃止する。
  - サーバーレス実行時間の上限、インメモリ購読者管理、Supavisor トランザクションプーラーでの `LISTEN` 非対応という 3 つの理由で、現行の常駐 SSE は成立しない。
  - `change_events` テーブルとその記録トリガー群は温存する。通知トリガー内の `pg_notify()` を `realtime.send()` へ差し替えるだけで済む。クライアントは Realtime の通知を合図に、既存の `GET /v1/events?after=` で差分を回収する。この回収経路は 3 クライアントとも実装済みで、そのまま流用できる。
- **BREAKING** 添付の実体を S3 から **Supabase Storage** へ移す。S3 互換 API（SigV4 署名付き URL）を備えるため `blob.Store` の実装差し替えで足りる。カスタム絵文字の png も同様に Supabase Storage から配信する。
- 常駐処理をサーバーレスの実行モデルへ適合させる。
  - 起動時の goose マイグレーションを削除し、デプロイ工程で適用する。
  - 添付リーパーの常駐 goroutine を Vercel Cron から叩く専用エンドポイントへ置き換える。
  - 絵文字同期 `emoji-sync` をデプロイ工程のジョブへ移す。
  - `pgxpool` を Supavisor トランザクションプーラー（ポート 6543）向けに明示設定する（接続数の抑制、prepared statement キャッシュの無効化）。
- **Vercel Hobby / Supabase Free の制約を吸収する仕掛けを入れる。**
  - Supabase Free は自動バックアップを持たないため、日次のデータベースエクスポートを CI から自動実行する。
  - Supabase Free は 1 週間データベースへのアクセスが無いとプロジェクトを一時停止するため、定期実行によってアクセスを絶やさない。
  - Vercel Hobby の Cron は最短 1 日 1 回・起動精度 ±59 分であるため、添付回収は GitHub Actions の定期実行を主、Vercel Cron を従として二重化する。回収処理が DB へ問い合わせることで、上記の一時停止回避も同時に満たす。
- 本番はまだ利用開始前でデータが存在しないため、**データの移送は行わない**。

## Capabilities

### New Capabilities

（なし。既存 capability の要件変更のみで、新しいユーザー価値は追加しない）

### Modified Capabilities

- `deployment`: コンテナ構成・Nginx リバースプロキシ・Certbot による証明書運用・`pg_bigm` 入り PostgreSQL という要件を、マネージドホスティング（Vercel）とマネージド PostgreSQL（Supabase）を前提とする要件へ全面的に置き換える。TLS と証明書更新はプラットフォームの責務となり、マイグレーションはランタイムではなくデプロイ工程で適用される。
- `authentication`: 認証プロバイダを AWS Cognito ユーザープールから Supabase Auth へ変更する。トークン検証（JWKS・issuer・audience・鍵ローテーション追随）、トークンの安全な保管、初回サインイン時のユーザー登録という要件の骨格は維持しつつ、プロバイダ固有の記述を差し替える。
- `full-text-search`: 索引実装を `pg_bigm` から PGroonga へ変更する。検索の外形的な振る舞い（日本語対応・語の途中一致・大文字小文字非依存・最小 2 文字）は変えない。
- `sync-and-storage`: 「変更の反映」の要件から SSE という手段への依存を外し、リアルタイム通知サービスによる変更通知と、取りこぼしを埋めるための差分取得という形へ改める。データ層の要件（source of truth・API 契約・永続化・階層移動の原子性・認可）は維持する。
- `attachments`: 実体の保存先を S3 バケットから Supabase Storage のバケットへ変更する。署名付き URL によるクライアント直接アップロード／ダウンロード、非公開バケット、サイズ・形式の検証、未確定分の回収という要件は維持する。
- `emoji-reactions`: カスタム絵文字 png の配信元を、API サーバのローカルファイルシステムからオブジェクトストレージへ変更する。カタログ登録がリポジトリ内 `emoji/` ディレクトリの png から導出されるという要件は維持する。

## Impact

- **削除**: `infra/` 一式（`docker-compose.yml`、Nginx 設定とテンプレート、Certbot スクリプト、自己署名証明書、`pg_bigm` ビルド用 Dockerfile、SSE プロキシ検証ハーネス）、`backend/Dockerfile`、ルート `Makefile` の `test-sse-proxy` ターゲット。
- **バックエンド（`backend/`）**:
  - 削除: `internal/httpapi/event_broker.go`、`internal/httpapi/events.go` の SSE ハンドラ、起動時マイグレーション、リーパーの常駐ループ。
  - 差し替え: `internal/auth/verifier.go`（JWKS URL・issuer・クレーム検証）、`internal/blob/s3.go` → Supabase Storage 実装、`internal/store/queries/search.sql` の 2 クエリ、`internal/httpapi/emojis.go` の画像配信、`internal/httpapi/server.go` の `pgxpool` 設定、`cmd/postall-server/main.go`（`PORT` 待受、環境変数、サブコマンド整理）。
  - 追加: Vercel Cron 用の内部エンドポイント（共有シークレットで保護）。
- **マイグレーション**: `pg_bigm` 拡張と `gin_bigm_ops` 索引の撤去、PGroonga 拡張と索引の作成、`pg_notify` トリガーの `realtime.send()` 化、`users` の識別子カラム改名。既存の再帰 CTE・部分索引・plpgsql トリガーはそのまま Supabase で動く。
- **API 契約（`api/openapi.yaml`）**: `GET /v1/events/stream` を削除。`POST /v1/attachments/uploads` の応答（署名付き URL とヘッダ）を Supabase Storage の形に合わせて見直す。生成物（`backend/internal/api/`、`frontend/src/api/schema.d.ts`、`mobile/lib/api/generated/`）が追随する。
- **フロントエンド（`frontend/`）**: `src/auth/pkce.ts` と `src/auth/AuthProvider.tsx` を Supabase Auth へ書き換え、`src/api/sse.ts` と `src/api/client.ts` の SSE 経路を Realtime 購読へ置換、`src/hooks/useChangeSync.ts` の接続管理を差し替え、`src/lib/upload.ts` のアップロード手順を見直し、`src/state/settings.ts` の Cognito 設定項目を Supabase の設定項目へ改める。`VITE_API_BASE_URL` の既定値が空文字（同一オリジン）であるため、API クライアント本体は無改修で済む。
- **Electron（`electron/`）**: `app://` によるローカル配信と `postall://` ディープリンクは維持。トークン保管（`safeStorage`）も維持。
- **iOS（`mobile/`）**: `lib/auth/cognito.dart` を Supabase Auth へ書き換え、`lib/api/http_postall_api.dart` の SSE 購読を Realtime 購読へ置換、`lib/state/settings.dart` の既定 API ベース URL を新ドメインへ変更。`Info.plist` の `postall` スキーム定義は維持。
- **CI（`.github/workflows/ci.yml`）**: 既存 4 ジョブは維持。マイグレーション適用・絵文字同期・Vercel デプロイの工程に加え、日次のデータベースエクスポートと 6 時間ごとの添付回収実行を追加する。`testcontainers` を使う統合テストは PGroonga 入りイメージへ切り替える。
- **外部サービス**: AWS（Cognito ユーザープール、S3 バケット）への依存が消え、Vercel プロジェクトと Supabase プロジェクトが新たに必要になる。Vercel Cron の実行本数はプランに依存する。
- **プラン制約**: Supabase Free はデータベース 500 MB・Storage 1 GB・Egress 5 GB・アクティブプロジェクト 2 つ。Vercel Hobby は非商用個人利用限定で、Git Organization 所有のリポジトリには接続できない（`sudabon/PostAll` が個人アカウント所有であることが前提）。プロキシ経由のリクエストタイムアウトは 120 秒。
- **データ移送**: 不要（利用開始前でデータが無い）。旧環境の破棄のみを行う。
- **ドキュメント**: `README.md` の前提・ローカル起動・AWS リソース表・運用メモを全面的に書き直す。
