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

### 暗号化バックアップ

`ops` workflow は日次で `public` schema のデータを dump し、gzip 圧縮後に GPG AES-256 で暗号化する。GitHub Actions の repository secrets には `DATABASE_URL` に加えて、十分に長いランダム値の `DUMP_PASSPHRASE` を登録する。Artifact へ渡すのは `postall.dump.sql.gz.gpg` だけで、平文と gzip は runner の一時領域から終了時に削除する。

暗号化済み dump は1件10 MiB以下、保持30日、upload 時の再圧縮なしとするため、日次実行分の保持量は最大でおよそ300 MiBになる。手動実行分も容量へ加算される。GitHub の Billing and licensing → Budgets and alerts では Actions storage の予算を `$0` にし、上限到達時に利用を停止する。secret 未設定、10 MiB超過、または無料枠上限ではバックアップ job が意図的に失敗し、追加課金へ移行しない。予算はアカウント／organization 側の設定であり、workflow からは設定できない。

復元先は空の DB とし、先に goose migration を適用する。`goose_db_version` は dump から除外済みなので、暗号化ファイルを平文として保存せず次のように流し込める。

```bash
set -o pipefail
gpg --decrypt postall.dump.sql.gz.gpg \
  | gzip -dc \
  | psql "$DATABASE_URL"
```

このバックアップに Supabase Storage の添付・絵文字オブジェクトは含まれない。絵文字は `emoji-sync` で再作成できるが、添付は失敗を許容する現行方針のため、利用量が増えた時点で別途バックアップ対象にする。

コールバック URI:

| クライアント | リダイレクト URI |
|---|---|
| PWA | `https://memo.sudabon.com/auth/callback` |
| Electron / iOS | `postall://auth/callback` |

### GitHub OAuth と招待制サインイン

サインインは Supabase Auth の GitHub provider に固定し、新規 signup は無効にする。GitHub OAuth App の Authorization callback URL は、アプリ側の URI ではなく Supabase の callback（本番は `https://<project-ref>.supabase.co/auth/v1/callback`、ローカル検証用 App は `http://127.0.0.1:54321/auth/v1/callback`）に設定する。本番の Supabase Dashboard では Authentication → Providers → GitHub に OAuth App の Client ID / Client secret を登録し、Redirect URLs に上表の Web とネイティブ向け URI が含まれることを確認する。

ローカルでは `.env.example` の `SUPABASE_AUTH_EXTERNAL_GITHUB_CLIENT_ID` と `SUPABASE_AUTH_EXTERNAL_GITHUB_SECRET` を `.env` に設定してから Supabase を起動する。GitHub OAuth App は callback URL が環境ごとに異なるため、本番用とローカル用を分ける。

利用者を追加するときは、初回 GitHub サインインより先に Supabase Dashboard の Authentication → Users でユーザーを作成し、GitHub が返す検証済みメールアドレスと完全に同じメールを確認済みにする。その後の GitHub サインインは Supabase の自動 identity linking により既存ユーザーへ結び付く。未登録メールの OAuth サインインは signup 無効設定により拒否される。

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
- 変更通知は SSE ではなく、DB トリガーの `realtime.send()` → クライアントが `postall:events` を購読 → `GET /v1/events?after=` で差分回収。Realtime が切れたら 15 秒間隔のポーリングへ退避し、指数バックオフで再接続する。ホストでは `realtime.messages` の RLS を goose から作れない場合がある（所有者が `supabase_admin`）。その場合は SQL Editor で `create policy postall_events_select on realtime.messages for select to authenticated using (realtime.topic() = 'postall:events' and extension = 'broadcast');` を実行する。42501 なら Database → Policies で schema `realtime` / table `messages` に、authenticated の SELECT を同じ topic / extension 条件で追加する。`using (true)` は他トピックを購読可能にするため使用しない。
- 添付回収は Vercel Cron（日次）と GitHub Actions（6 時間ごと）が `POST /internal/attachments/reap` を叩く。後者は Supabase Free の pause 回避（keep-alive）を兼ねる。
- 日次の `supabase db dump --data-only --schema public` は gzip + GPG AES-256 で暗号化し、Actions のアーティファクトに30日残す。平文 dump はアップロードしない。復元手順と無料枠の停止設定は「暗号化バックアップ」を参照する。Storage の実体はダンプ対象外。
- 容量の確認: Supabase ダッシュボードの Database → Reports、および Storage のバケット使用量。Free は DB 500 MB・Storage 1 GB。近づいたら Pro への引き上げか添付サイズ上限の引き下げを検討する。
- iOS の Mermaid 描画は WebView に `mermaid.min.js` を載せる。React 側と同じバンドルを使うため、`frontend` の依存を入れたうえで `make -C mobile assets` を実行してから iOS をビルドする。
- iOS の接続設定は `--dart-define` の既定値をアプリ内の「接続設定」から上書きできる。トークンは Keychain に保管する。Electron は `safeStorage`。ブラウザは永続ストレージへ平文で置かない。
