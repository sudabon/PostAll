# PostAll

Slack 風のポスト型メモ管理アプリケーション。チャネルへ放り込むだけで時系列に積み上がり、後から階層で束ね直せる。

macOS（Electron）、ブラウザ（PWA）、iOS（Flutter）の 3 経路から、同じ Vercel 上の Go API / Supabase（PostgreSQL + Auth + Storage）を参照する。

## リポジトリ構成

```
PostAll/
├── api/          # OpenAPI 仕様（3 クライアント共通の契約）
├── backend/      # Go HTTP API（Vercel `api` サービス）
├── frontend/     # React + Vite + Tailwind + shadcn/ui（Electron と PWA の共通コード）
├── electron/     # Electron メインプロセスとパッケージング
├── mobile/       # Flutter（iOS）
├── emoji/        # カスタム絵文字 png
├── supabase/     # ローカルスタック（`supabase start`）。スキーマ本体は backend/migrations
└── openspec/     # 仕様と change
```

## 前提

- Go 1.26+
- Node.js 22+
- Flutter 3.32（iOS シミュレータまたは実機）
- Supabase CLI（ローカル DB とダンプ）
- Vercel CLI（任意。プレビューは Git 連携で足りる）
- 本番: Vercel Hobby + Supabase Free、ドメイン `memo.sudabon.com`

## ローカル起動

スキーマの正は `backend/migrations`（goose）。`supabase/migrations` には置かない。

```bash
# Auth / Realtime / Storage / Postgres（初回はイメージ取得で数分かかる）
supabase start
supabase status -o env

# 空のローカル DB へマイグレーション（ダイレクト接続 54322）
cd backend
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres \
  go run ./cmd/postall-server migrate

# フロントエンド（Vite 既定 :5173。API は同一オリジン想定）
cd frontend && npm install && npm run dev

# API（DATABASE_URL 未設定なら /health は DB をスキップ）
cd backend && go run ./cmd/postall-server

# web + api をまとめて
npx vercel dev

# iOS（接続先は --dart-define で渡す）
cd mobile
# assets/mermaid/mermaid.min.js はリポジトリに入っている。
# 更新するときだけ `make assets`（frontend/node_modules から取り込む）。
flutter run -d iphone \
  --dart-define=POSTALL_API_BASE_URL=https://memo.sudabon.com \
  --dart-define=POSTALL_SUPABASE_URL=https://<project>.supabase.co \
  --dart-define=POSTALL_SUPABASE_PUBLISHABLE_KEY=<publishable-key>
```

ローカルの資格情報は `supabase status` が出す。`.env.example` と `frontend/.env.example` をコピーして埋める。API の実行時 `DATABASE_URL` はプール（54329、transaction）でもよい。migrate と `emoji-sync` はダイレクト（54322）を使う。

絵文字カタログの同期:

```bash
cd backend
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres \
  EMOJI_S3_BUCKET=emojis \
  S3_ENDPOINT=http://127.0.0.1:54321/storage/v1/s3 \
  S3_REGION=local \
  S3_ACCESS_KEY_ID=<from supabase status> \
  S3_SECRET_ACCESS_KEY=<from supabase status> \
  go run ./cmd/postall-server emoji-sync
```

## 環境変数

API（Vercel）:

| 変数 | 用途 |
|---|---|
| `DATABASE_URL` | Supavisor トランザクションモード（ポート 6543） |
| `SUPABASE_URL` | Auth JWKS と issuer |
| `S3_ENDPOINT` / `S3_REGION` / `S3_BUCKET` / `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | 添付 Storage |
| `EMOJI_S3_BUCKET` | 絵文字 Storage |
| `CRON_SECRET` | `POST /internal/attachments/reap` の Bearer |

フロント（Vite）: `VITE_SUPABASE_URL`、`VITE_SUPABASE_PUBLISHABLE_KEY`。API ベース URL の既定は空（同一オリジン）。

CI のマイグレーション / ダンプは **Session プール**（`*.pooler.supabase.com:5432`）の `DATABASE_URL` を GitHub Actions の secret に置く。Direct（`db.<ref>.supabase.co:5432`）は IPv6 専用で、IPv4 だけのネットワーク（このマシンや GitHub-hosted runner）からは届かない。IPv4 アドオンは不要。

コールバック URI:

| クライアント | リダイレクト URI |
|---|---|
| PWA | `https://memo.sudabon.com/auth/callback` |
| Electron / iOS | `postall://auth/callback` |

## 開発コマンド

```bash
make test
make lint
make generate   # OpenAPI からのコード生成。CI で git diff --exit-code する
```

`make generate` は backend（oapi-codegen）と mobile（swagger_parser + build_runner）の
両方を回す。mobile 側は `api/openapi.yaml` を正規化した中間 JSON から
`mobile/lib/api/generated/models/` を作り、REST クライアントは手書きの
`mobile/lib/api/http_postall_api.dart` を使う。

## 運用メモ

- PostgreSQL は Supabase。全文検索は PGroonga（`pgroonga_text_regexp_ops_v2`）。PGroonga の索引はクラッシュで壊れることがあり、そのときは `REINDEX INDEX posts_body_pgroonga;`（実索引名は `\d posts` で確認）で作り直す。
- 接続の使い分け: API（Vercel）は Transaction プール（6543）。migrate / `emoji-sync` / `db dump` は Session プール（`pooler.supabase.com:5432`）。Direct は IPv6 のみ。
- 変更通知は SSE ではなく、DB トリガーの `realtime.send()` → クライアントが `postall:events` を購読 → `GET /v1/events?after=` で差分回収。Realtime が切れたら 15 秒間隔のポーリングへ退避する。ホストでは `realtime.messages` の RLS を goose から作れない（所有者が `supabase_admin`）。SQL Editor で `create policy postall_events_select on realtime.messages for select to authenticated using (true);` を実行する。42501 なら Database → Policies で schema `realtime` / table `messages` に同じ内容を足す。
- 添付回収は Vercel Cron（日次）と GitHub Actions（6 時間ごと）が `POST /internal/attachments/reap` を叩く。後者は Supabase Free の pause 回避（keep-alive）を兼ねる。
- 日次の `supabase db dump` は Actions のアーティファクトに残す。Storage の実体はダンプ対象外。復元するときは空 DB へ goose migrate したうえで `--data-only --schema public` を流す。`goose_db_version` が衝突したらそのテーブルは除外する。
- 容量の確認: Supabase ダッシュボードの Database → Reports、および Storage のバケット使用量。Free は DB 500 MB・Storage 1 GB。近づいたら Pro への引き上げか添付サイズ上限の引き下げを検討する。
- iOS の Mermaid 描画は WebView に `mermaid.min.js` を載せる。React 側と同じバンドルを使うため、`frontend` の依存を入れたうえで `make -C mobile assets` を実行してから iOS をビルドする。
- iOS の接続設定は `--dart-define` の既定値をアプリ内の「接続設定」から上書きできる。トークンは Keychain に保管する。Electron は `safeStorage`。ブラウザは永続ストレージへ平文で置かない。
