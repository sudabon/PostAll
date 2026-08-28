# SETUP GUIDE

ローカル開発環境の構築手順。本番環境の初期構築とデプロイは [DEPLOYMENT.md](DEPLOYMENT.md)、全体像は [ARCHITECTURE.md](ARCHITECTURE.md) を参照。

所要時間の目安は 30〜60 分（`supabase start` の初回イメージ取得と GitHub OAuth App の作成が大半）。

## 1. 前提条件

| ツール | バージョン | 用途 | 確認 |
|---|---|---|---|
| Go | 1.26 以上 | API サーバ、マイグレーション | `go version` |
| Node.js | 22 以上 | frontend / Electron | `node -v` |
| Docker | 起動していること | `supabase start`、テストの testcontainers | `docker info` |
| Supabase CLI | 最新 | ローカルスタック、DB ダンプ | `supabase --version` |
| Flutter | 3.32 系 | iOS クライアント（不要なら省略可） | `flutter --version` |
| Xcode | Flutter を使う場合 | iOS シミュレータ・実機 | `xcodebuild -version` |
| Vercel CLI | 最新（任意） | `vercel dev` で web+api を同時起動 | `npx vercel --version` |

macOS を想定している。`emoji-sync` を試すには Supabase のローカル Storage が要るため、Docker は必須と考えてよい。

インストールされていない場合:

```bash
brew install go node docker supabase/tap/supabase
brew install --cask flutter        # iOS が必要な場合のみ
```

## 2. リポジトリの取得

```bash
git clone https://github.com/sudabon/PostAll.git
cd PostAll
```

## 3. GitHub OAuth App を用意する（ローカル用）

サインインは Supabase Auth の GitHub provider に固定されているため、これが無いとアプリにログインできない。**本番用とは別に、ローカル検証用の OAuth App を作る**（callback URL が異なるため兼用できない）。

1. GitHub → Settings → Developer settings → OAuth Apps → New OAuth App
2. 次を入力して作成する。

   | 項目 | 値 |
   |---|---|
   | Application name | `PostAll (local)` など |
   | Homepage URL | `http://127.0.0.1:5173` |
   | Authorization callback URL | `http://127.0.0.1:54321/auth/v1/callback` |

3. Client ID を控え、Generate a new client secret で secret を発行して控える。

> callback URL は**アプリではなく Supabase の callback** を指す。アプリ側の `http://127.0.0.1:5173/auth/callback` を入れると認証が完了しない。

## 4. 環境変数を用意する

ルートと frontend の 2 か所にサンプルがある。

```bash
cp .env.example .env
cp frontend/.env.example frontend/.env
```

`.env` に手順 3 の値を入れる。この 2 つは Supabase CLI が `supabase/config.toml` の `env(...)` 経由で読むため、**`supabase start` の前に**設定しておく。

```dotenv
SUPABASE_AUTH_EXTERNAL_GITHUB_CLIENT_ID=<Client ID>
SUPABASE_AUTH_EXTERNAL_GITHUB_SECRET=<Client secret>
```

残りの値は次の手順で `supabase status` が出すものを埋める。

## 5. Supabase ローカルスタックを起動する

```bash
supabase start          # 初回はイメージ取得で数分かかる
supabase status -o env  # 資格情報の一覧
```

起動するポート:

| サービス | URL / ポート |
|---|---|
| API Gateway（Auth / Storage / Realtime） | `http://127.0.0.1:54321` |
| PostgreSQL（ダイレクト） | `54322` |
| Connection pooler（transaction） | `54329` |
| Studio | `http://127.0.0.1:54323` |

`supabase status -o env` の出力から `.env` の残りを埋める。

```dotenv
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres
SUPABASE_URL=http://127.0.0.1:54321
S3_ENDPOINT=http://127.0.0.1:54321/storage/v1/s3
S3_REGION=local
S3_BUCKET=attachments
EMOJI_S3_BUCKET=emojis
S3_ACCESS_KEY_ID=<status の S3 access key>
S3_SECRET_ACCESS_KEY=<status の S3 secret key>
CRON_SECRET=dev-cron-secret
```

`frontend/.env` には publishable key（`status` の `ANON_KEY`）を入れる。`VITE_API_BASE_URL` は空のまま（同一オリジン想定）でよい。

```dotenv
VITE_API_BASE_URL=
VITE_SUPABASE_URL=http://127.0.0.1:54321
VITE_SUPABASE_PUBLISHABLE_KEY=<publishable / anon key>
```

`attachments`（25 MiB）と `emojis`（1 MiB, PNG のみ）のバケットは `supabase/config.toml` に定義済みで、`supabase start` が作る。

## 6. データベースを初期化する

**スキーマの正は `backend/migrations`（goose）**。`supabase db reset` のマイグレーションではなく、Go のサブコマンドで適用する。

```bash
cd backend
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres \
  go run ./cmd/postall-server migrate
```

適用漏れの確認（本番デプロイ前の検査と同じもの）:

```bash
DATABASE_URL=… go run ./cmd/postall-server migrate-check
```

> migrate はダイレクト接続（54322）を使う。goose はセッション状態を必要とするため、transaction プール（54329）では通らない。

## 7. 絵文字カタログを同期する

`emoji/` の png を Storage と `emojis` テーブルへ流し込む。これを飛ばすとリアクションの絵文字が出ない。

```bash
cd backend
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres \
  EMOJI_S3_BUCKET=emojis \
  S3_ENDPOINT=http://127.0.0.1:54321/storage/v1/s3 \
  S3_REGION=local \
  S3_ACCESS_KEY_ID=<status の値> \
  S3_SECRET_ACCESS_KEY=<status の値> \
  go run ./cmd/postall-server emoji-sync
```

`created=… updated=… unchanged=… skipped=…` が出れば成功。Storage を使わず DB だけ更新したい場合は `EMOJI_SKIP_STORAGE=1` を付ける。

## 8. サーバを起動する

### API のみ

```bash
cd backend
set -a; source ../.env; set +a
go run ./cmd/postall-server     # :8080（PORT または LISTEN_ADDR で変更可）
```

`DATABASE_URL` を設定しなければ DB 無しでも起動し、`/health` は `"database": "skipped"` を返す。

### frontend のみ

```bash
cd frontend
npm install
npm run dev                     # http://127.0.0.1:5173
```

### web + api をまとめて（推奨）

`vercel.json` の rewrite がそのまま効くため、本番と同じ「同一オリジンで `/v1/*` が API へ」という構成で確認できる。

```bash
npx vercel dev
```

## 9. サインインできるようにする（招待制）

新規 signup は無効なので、**先に Supabase 側でユーザーを作ってから** GitHub サインインする。

1. Studio（`http://127.0.0.1:54323`）→ Authentication → Users → Add user
2. GitHub アカウントの**検証済みメールアドレスと完全に同一**のメールで作成し、確認済みにする
3. アプリで「GitHub でサインイン」を実行する

Supabase の自動 identity linking で既存ユーザーに紐付く。未登録メールでの OAuth サインインは signup 無効設定により拒否される。

## 10. 動作確認

```bash
# API が生きているか（DB 接続込み）
curl -s http://127.0.0.1:8080/health
# => {"status":"ok","database":"ok"}

# 認証が効いているか（トークン無しは 401）
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8080/v1/channels
# => 401

# 保守エンドポイント（CRON_SECRET が要る）
curl -s -o /dev/null -w '%{http_code}\n' -X POST \
  -H "Authorization: Bearer dev-cron-secret" \
  http://127.0.0.1:8080/internal/events/prune
# => 204
```

ブラウザで `http://127.0.0.1:5173`（または `vercel dev` の URL）を開き、GitHub でサインイン → チャネル作成 → ポスト投稿 → リアクション → 検索、まで通れば環境構築は完了。

2 つのブラウザタブを開いて片方から投稿し、もう片方に自動で反映されれば Realtime 経由の変更同期も動いている。

## 11. Electron（macOS）を動かす

Electron は開発時も **ビルド済みの `frontend/dist`** を `app://` プロトコルで読む。Vite の dev サーバは見に行かないので、先にビルドが必要。

```bash
cd frontend && npm run build
cd ../electron && npm install && npm start
```

フロントを変更したら `npm run build` をやり直す。パッケージング（macOS, 未署名）は `npm run pack`。

## 12. iOS（Flutter）を動かす

接続先は `--dart-define` で渡す。アプリ内の「接続設定」から実行時に上書きもできる。

```bash
cd mobile
flutter pub get
flutter run -d iphone \
  --dart-define=POSTALL_API_BASE_URL=http://127.0.0.1:8080 \
  --dart-define=POSTALL_SUPABASE_URL=http://127.0.0.1:54321 \
  --dart-define=POSTALL_SUPABASE_PUBLISHABLE_KEY=<publishable key>
```

Mermaid 描画用の `assets/mermaid/mermaid.min.js` はリポジトリに含まれている。更新するときだけ、frontend の依存を入れたうえで取り込む。

```bash
cd frontend && npm install
make -C mobile assets
```

## 13. テストと lint

```bash
make test       # go test ./... / vitest / flutter test
make lint       # go vet / oxlint + eslint / flutter analyze
make typecheck  # tsc -b
```

Go の統合テストは testcontainers で PostgreSQL を起動するため **Docker が必要**。E2E は Playwright で、初回はブラウザの取得が要る。

```bash
cd frontend
npx playwright install
npm run test:e2e     # app（:4173）と pwa（:4174）の 2 プロジェクト
```

## 14. コード生成

`api/openapi.yaml` を変更したら生成物を更新する。CI は生成物の差分を `git diff --exit-code` で落とす。

```bash
make generate            # backend（oapi-codegen）+ mobile（swagger_parser）
cd frontend && npm run generate   # src/api/schema.d.ts
cd backend && go tool sqlc generate  # SQL を変更したとき
```

sqlc のスキーマは `backend/internal/store/schema.sql`。`backend/migrations` に変更を入れたら、こちらも同じ最終形になるよう手で更新する。

## よくある問題

### `supabase start` が失敗する / ポートが埋まっている

Docker が起動しているか確認する。前回のスタックが残っている場合は停止してから再実行する。

```bash
docker info                # daemon が動いているか
supabase stop && supabase start
supabase stop --no-backup  # データごと作り直す場合
```

### GitHub サインインで戻ってこない / `redirect_uri_mismatch`

OAuth App の Authorization callback URL が `http://127.0.0.1:54321/auth/v1/callback`（Supabase 側）になっているか確認する。アプリ側の `/auth/callback` は `supabase/config.toml` の `additional_redirect_urls` に列挙済みで、こちらを OAuth App に入れるのは誤り。

`.env` の `SUPABASE_AUTH_EXTERNAL_GITHUB_*` を後から足した場合は、`supabase stop && supabase start` で読み直す。

### サインインは通るのにアプリに入れない

signup 無効の招待制のため。手順 9 で Studio から同じメールアドレスのユーザーを先に作る。

### `ERROR: extension "pgroonga" is not available`（マイグレーション）

Supabase の公式イメージ以外の PostgreSQL に対して `migrate` を流している。`DATABASE_URL` が `supabase start` の DB（`127.0.0.1:54322`）を指しているか確認する。

### `prepared statement "..." already exists`（SQLSTATE 42P05）

transaction pooling 越しに名前付きプリペアドを使ったときのエラー。API は `QueryExecModeDescribeExec` で回避済みなので、これが出るのは pooler（54329 / 本番 6543）へ goose や psql のセッション前提の処理を流している場合。migrate と `emoji-sync` はダイレクト接続（ローカル 54322 / 本番 Session pooler 5432）を使う。

### 本番の `DATABASE_URL` に繋がらない（タイムアウト）

Direct 接続（`db.<ref>.supabase.co:5432`）は IPv6 専用で、IPv4 のみのネットワーク（多くの自宅回線や GitHub-hosted runner）から届かない。Session pooler（`*.pooler.supabase.com:5432`）の URL を使う。IPv4 アドオンは不要。

### 検索が何も返さない

PGroonga の索引が壊れている可能性がある。実索引名を `\d posts` で確認して作り直す。

```sql
REINDEX INDEX posts_body_pgroonga;
```

### 絵文字が `:shortcode:` のテキストのままになる

`emoji-sync`（手順 7）が未実行か、Storage への同期に失敗している。`S3_*` を設定して再実行する。絵文字画像は Bearer 認証付きで取得するため、サインインしていない状態でも同じ見た目になる。

### 変更が他のクライアントに伝わらない

Realtime 通知はベストエフォートで、失敗しても書き込み自体は成功する。まず `postall_notify_failures` を見る。

```sql
select * from postall_notify_failures order by day desc limit 7;
```

件数が伸びている場合は `realtime.messages` の RLS ポリシーを確認する。ホスト環境ではテーブルの所有者が `supabase_admin` で、goose からポリシーを作れず（42501）スキップされていることがある。その場合は SQL Editor で適用する。

```sql
create policy postall_events_select
    on realtime.messages
    for select to authenticated
    using (realtime.topic() = 'postall:events' and extension = 'broadcast');
```

なお Realtime が切れてもクライアントは 15 秒間隔のポーリングへ退避するため、反映が遅いだけで止まりはしない。

### Electron に変更が反映されない

`frontend/dist` を読んでいるため。`cd frontend && npm run build` をやり直す。

### `make test` の Go テストが Docker のエラーで落ちる

testcontainers が PostgreSQL を起動できていない。Docker を起動し、`docker info` が通る状態で再実行する。Colima 等を使う場合は `DOCKER_HOST` の設定が要ることがある。
