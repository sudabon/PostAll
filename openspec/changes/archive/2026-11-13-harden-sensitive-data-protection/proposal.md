## Why

PostAll に秘匿性の高いメモを置けるかを点検したところ、外部からの直接アクセス（Data API 経由の RLS 迂回、Storage の公開、JWT の偽造）は塞がれていた。一方で「どのアカウントが読めるか」「消したものが本当に消えるか」「バックアップを誰が開けるか」「XSS が起きたときに何が漏れるか」の 4 点で、守りが 1 枚しかないか、意図と実装が食い違っていた。

- 利用者を限定しているのは、Supabase ダッシュボードの「新規 signup を無効化」の設定だけである。API は有効な JWT であれば誰でも `users` 行を自動で作り、チャネルに所有者の概念も無い。この設定を一度でも誤って有効にすると、任意の GitHub アカウントが全メモを読める。
- ポストの削除は `deleted_at` を立てるだけで、本文は DB と日次バックアップに残り続ける。秘匿情報を書いて消した利用者は、消えたと誤解する。
- 日次バックアップは公開リポジトリの Actions アーティファクトに置かれている。サインインした任意の GitHub ユーザーが取得できる。守りは共通鍵のパスフレーズ 1 つで、その鍵は CI に置かれている。
- ブラウザ / PWA はトークンを `localStorage` に置いている。仕様上は意図どおりだが、XSS が 1 件でもあればトークンを盗まれる。それを抑える CSP が `frame-ancestors` しか無い。また ARCHITECTURE.md は「永続ストレージへ平文で置かない」と書いており、実装と食い違っている。
- Electron は `safeStorage` が使えない環境で、トークンを平文のファイルへ書き出す。
- 認証は GitHub OAuth 単独で、運用アカウント（GitHub / Supabase / Vercel）の多要素認証が手順として明文化されていない。

## What Changes

- **API 側の許可リスト**: 環境変数 `ALLOWED_AUTH_SUBJECTS`（Supabase のユーザー ID の列挙）に含まれない `sub` の要求を 403 `account_not_allowed` で拒否する。拒否したアカウントの `users` 行は作らない。未設定なら誰も通さない（fail-closed）。クライアントはこの応答を受けたらサインアウトし、利用が許可されていない旨をサインイン画面に示す。**BREAKING**（運用）: デプロイ前に `ALLOWED_AUTH_SUBJECTS` の設定が必要になる。
- **削除時の本文消去**: ポストを論理削除する際、同じ更新で `body` を空文字にする。既に削除済みのポストの本文も、マイグレーションで空にする。削除済みであることを示す行と、スレッド構造は残す。
- **バックアップの公開鍵暗号化**: 日次ダンプの暗号化を、共通鍵（`DUMP_PASSPHRASE`）から、リポジトリに置いた公開鍵への暗号化へ切り替える。CI は復号できる鍵を持たない。秘密鍵は運用者が CI の外で保管する。切り替え後、旧形式のアーティファクトと `DUMP_PASSPHRASE` を削除する手順を定める。
- **CSP の追加**: ビルド時に `index.html` へ CSP の `<meta>` を差し込み、スクリプトの実行元を自オリジンに限定する。接続先は自オリジンと Supabase の 1 プロジェクトだけに絞る。Vercel のヘッダーでは `frame-ancestors 'none'` を維持する。Electron も同じ成果物を読み込むため、同じポリシーが適用される。
- **ドキュメントの整合**: ARCHITECTURE.md のトークン保管の記述を実装と仕様に合わせる。あわせて許可リスト・削除・バックアップ・CSP の設計を反映する。
- **運用アカウントの多要素認証**: GitHub・Supabase・Vercel の各アカウントで 2FA（パスキー推奨）を必須とすることを、DEPLOYMENT.md と SETUP_GUIDE.md のチェックリストに加える。
- **Electron の平文保存の禁止**: `safeStorage` が使えない場合、トークンはメモリにだけ持ち、ファイルへ書かない。過去に平文で書いたファイルが残っていれば削除する。

### Non-goals

- アプリ層での本文暗号化や E2E 暗号化。全文検索（PGroonga）がサーバ側で本文を必要とするため、本 change では扱わない。
- Supabase Auth の MFA（`aal2`）をアプリで強制すること。TOTP の登録・チャレンジ画面が必要になるため、別 change とする。
- ユーザーごとの閲覧権限（チャネルの所有者・共有）。許可したアカウント全員が全データを共有する、現在のモデルは変えない。
- 過去 30 日分の既存バックアップから、削除済み本文を取り除くこと。保持期限が来れば消えるため、旧アーティファクトの削除手順でまとめて扱う。

## Capabilities

### New Capabilities

なし。

### Modified Capabilities

- `authentication`: 「利用を許可するアカウントの限定」を追加する。「ユーザーの登録」を許可されたアカウントに限る。「トークンの安全な保管」に、デスクトップで安全な保管領域が使えない場合は永続化しないことを追加する。
- `post-timeline`: 「ポストの論理削除」に、削除と同時に本文をデータベースから消去することを追加する。スレッド内の返信は `post-threads` の「同じ規則を適用」によりこれに従う。
- `deployment`: 「データのエクスポート」に、エクスポートを公開鍵で暗号化することと、実行基盤が復号鍵を持たないことを追加する。
- `rich-content-rendering`: 「スクリプト実行元の制限」を追加する。無害化をすり抜けた入力があっても、自オリジン以外のスクリプトを実行せず、許可していない接続先へ通信しないこと。

## Impact

- **Backend**: `backend/internal/auth/middleware.go`（許可リストの判定と 403）、`backend/cmd/postall-server/main.go` と `backend/internal/httpapi/server.go`（`ALLOWED_AUTH_SUBJECTS` の読み込みと受け渡し）、`backend/internal/store/queries/posts.sql`（`SoftDeletePost` で `body` を空にする。あわせて sqlc の再生成）、新規マイグレーション `00016_erase_deleted_post_bodies.sql`。
- **API 契約**: `api/openapi.yaml` に共通の 403 応答（`code: account_not_allowed`）を追加する。生成物（Go / TypeScript）を再生成する。
- **Frontend**: `frontend/src/api/client.ts`（`account_not_allowed` の検知）、`frontend/src/auth/auth-provider.tsx` と `frontend/src/components/auth/SignInScreen.tsx`（サインアウトと案内の表示）、`frontend/vite.config.ts`（CSP を差し込むビルドプラグイン）。
- **Electron**: `electron/main.mjs`（トークン保管の分岐）。テストできるよう、保管処理を `electron/secret-store.mjs` へ切り出す。
- **CI / 運用**: `.github/workflows/ops.yml`（`db-dump` の公開鍵暗号化と検証）、公開鍵ファイル `ops/backup/postall-backup.pub.asc` の追加、GitHub secret `DUMP_PASSPHRASE` の廃止、Vercel の環境変数 `ALLOWED_AUTH_SUBJECTS` の追加。
- **ドキュメント**: `ARCHITECTURE.md`、`DEPLOYMENT.md`、`SETUP_GUIDE.md`、`README.md`、`.env.example`。
- **依存**: 追加しない（GPG は GitHub-hosted runner に同梱されている）。
