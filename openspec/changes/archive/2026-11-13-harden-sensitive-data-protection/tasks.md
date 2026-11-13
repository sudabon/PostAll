## 1. 契約と生成物

- [x] 1.1 `api/openapi.yaml` の `components.responses` に `AccountNotAllowed`（403、既存の `Error` スキーマ、`code: account_not_allowed` の例付き）を追加し、`/health`・`/ready`・`/internal/*` を除く全オペレーションの `responses` から `'403'` として参照する。既に別の 403 を宣言しているオペレーション（添付のダウンロードなど）は、説明文に両方の意味を書く。YAML が既存の並びと命名に沿っていることを目視で確認する
- [x] 1.2 `make generate` と `cd frontend && npm run generate` を実行し、`git diff --exit-code` で生成物の追従漏れが無いことを確認する

## 2. バックエンド: 許可リスト

- [x] 2.1 `backend/internal/auth` に許可集合の型（`AllowedSubjects`）と、カンマ区切り文字列からの構築関数を追加する（前後の空白・空要素を無視し、小文字に正規化する）。単体テストで、空文字・未設定・空白のみ・大文字混じり・重複・前後空白の各ケースを確認する
- [x] 2.2 `auth.Middleware` に許可集合を渡す引数を追加し、「JWT 検証 → 許可判定 → `ResolveByAuthSubject`」の順で判定する。許可外は `403 {"code":"account_not_allowed",...}` を返す。`middleware_test.go` で、許可内が通る・許可外が 403 になり `ResolveByAuthSubject` が呼ばれない・空集合で全員 403・`skipAuth` の 4 経路は許可集合に関係なく通る、の 4 点を確認する
- [x] 2.3 `httpapi.Config` に `AllowedAuthSubjects []string` を追加して `auth.Middleware` へ渡す。`cmd/postall-server/main.go` で `ALLOWED_AUTH_SUBJECTS` を読み、空なら起動時に `slog.Warn` を出す（起動は止めない）。`go build ./...` が通ることを確認する
- [x] 2.4 既存の integration test のサーバ構築ヘルパーが、テスト用 JWT の `sub` を許可集合に含めるようにする。`go test ./...`（testcontainers を含む）が、変更前と同じ件数で通ることを確認する
- [x] 2.5 `internal/httpapi` に integration test を追加する: 許可リスト外の正当な JWT が 401 ではなく 403 `account_not_allowed` になり `users` 行が増えない / 許可リストが空のとき全要求が 403 / `users` 行が既にある `sub` を許可リストから外すと 403 / 許可リストが空でも `/health`・`/ready`・`CRON_SECRET` 付きの `/internal/*` は従来どおり応答する。`go test ./internal/httpapi/...` で確認する

## 3. バックエンド: 削除時の本文消去

- [x] 3.1 `backend/internal/store/queries/posts.sql` の `SoftDeletePost` の `set` に `body = ''` を加え、`sqlc generate` で `posts.sql.go` を再生成する。CI の「Check sqlc generated files」と同じコマンドで差分が無いことを確認する
- [x] 3.2 `backend/migrations/00016_erase_deleted_post_bodies.sql` を追加する。Up は `update posts set body = '' where deleted_at is not null and body <> ''`、Down は no-op とし、戻せない理由をコメントに書く。`migrations_test.go` に、`00015` まで適用した状態で本文付きの削除済み行を入れ、`00016` 適用後に `body` が空・`deleted_at` と `thread_root_id` が保持されていることを確認するテストを追加する
- [x] 3.3 `posts_integration_test.go` に、ポストと返信を削除した後の DB 行で、`body = ''`・`deleted_at` が非 null・返信の `thread_root_id` が保持されていることを確認するテストを追加する。`search_integration_test.go` に、削除済みポストの語で検索しても当たらないことを確認するテストを追加する（PGroonga 入りの testcontainers で実行）

## 4. フロントエンド: 拒否を受けたときのサインアウト

- [x] 4.1 `frontend/src/api/client.ts` の `ApiClient` に `onAccountNotAllowed` のコールバックを受け取る口を追加し、403 かつ `code === 'account_not_allowed'` のときに呼んでから `ApiError` を投げる。`client.test.ts` で、`account_not_allowed` ではコールバックが呼ばれ、`forbidden` などの他の 403 と 401 では呼ばれないことを確認する
- [x] 4.2 `frontend/src/auth/auth-provider.tsx` でコールバックを `signOut()` と案内文の設定につなぐ。`signOut` は冪等にし、並行して複数回呼ばれても 1 回だけ処理する。案内文はサインイン画面を離れるまで保持する。`AuthProvider.test.tsx` で、拒否を 2 回同時に受けても `signOut` の処理が 1 回で、案内が 1 つだけ出ることを確認する
- [x] 4.3 `frontend/src/components/auth/SignInScreen.tsx` が案内文（「このアカウントでは利用が許可されていません」）を既存の `error` 表示の経路で出すことを `SignInScreen.test.tsx` で確認する

## 5. フロントエンド: CSP

- [x] 5.1 `frontend/vite-plugins/csp.ts` に、`apply: 'build'` で `transformIndexHtml` から `<head>` 先頭へ CSP の `<meta>` を差し込むプラグインを実装する。ポリシーは design.md D5 のとおりで、`VITE_SUPABASE_URL` から `https:` と `wss:` の origin を導く。`VITE_API_BASE_URL` が別 origin のときだけ `connect-src` に加え、`VITE_SUPABASE_URL` が未設定なら Supabase の origin を出さない。`tsconfig.node.json` の `include` に新しいファイルを加える
- [x] 5.2 `frontend/vite-plugins/csp.test.ts`（vitest）で、ポリシー文字列の組み立てを確認する: `script-src` が `'self' 'wasm-unsafe-eval'` だけで `'unsafe-inline'`・`'unsafe-eval'` を含まない / `object-src 'none'` と `base-uri 'self'` がある / Supabase の URL から `https:` と `wss:` の origin が出る / 未設定時に出ない / 同一 origin の API は追加しない。同じファイルで `../vercel.json` を読み、全パスのヘッダーに `frame-ancestors 'none'` が残っていることも確認する
- [x] 5.3 `frontend/vite.config.ts` にプラグインを登録し、`npm run build` の後に `dist/index.html` へ `<meta http-equiv="Content-Security-Policy">` が 1 つだけ入っていることを確認する。`npm run dev` の HTML には入らないことも確認する

## 6. Electron: 平文保存の禁止

- [x] 6.1 `electron/secret-store.mjs` に `createSecretStore({ safeStorage, fs, filePath })` を実装する（`load()` / `save(map)` / `clear()`、design.md D6 の分岐どおり）。`electron/main.mjs` の `loadStores` / `saveSecrets` と `secret:*` の IPC をこれ経由に置き換える。`cd electron && npm start` で、サインインと再起動後の復元が従来どおり動くことを手動で確認する
- [x] 6.2 `electron/test/secret-store.test.mjs`（`node --test`）で、偽の `safeStorage` と `fs` を注入して確認する: 使えるときは暗号文だけを書く / 使えないときは書かずに既存ファイルを消し、メモリ上の値は返る / 使えないときの `load` は空を返す / 平文 JSON のファイルは読まずに削除する / 復号できないファイルは空を返して削除する。`cd electron && node --test test/*.test.mjs` で確認する

## 7. バックアップの公開鍵暗号化

- [x] 7.1 【運用者】バックアップ用の GPG 鍵を作り（design.md D4 のコマンド）、秘密鍵を CI の外の 2 か所に保管する。公開鍵を `gpg --armor --export` で `ops/backup/postall-backup.pub.asc` に書き出してコミットする。`gpg --show-keys ops/backup/postall-backup.pub.asc` で、暗号化用サブ鍵（`[E]`）があることを確認する
- [x] 7.2 `ops/backup/verify-dump-recipients.sh <encrypted> <public-key>` を実装する。`gpg --list-packets` の出力に `:symkey enc packet:` が無いこと、`:pubkey enc packet:` の keyid がすべて公開鍵ファイルの暗号化サブ鍵と一致することを確かめ、満たさなければ非ゼロで終了する。`shellcheck` が通ることを確認する
- [x] 7.3 `ops/backup/verify-dump-recipients.test.sh` を実装する。一時的な `GNUPGHOME` に使い捨ての鍵を 2 本作り、「正しい鍵宛て（0 で終了）」「`--symmetric`（非 0）」「別の鍵宛て（非 0）」「正しい鍵 + 共通鍵の併用（非 0）」の 4 ケースを確認する。`.github/workflows/ci.yml` にこの試験を走らせる job を追加し、ローカルでも `bash ops/backup/verify-dump-recipients.test.sh` が通ることを確認する
- [x] 7.4 `.github/workflows/ops.yml` の `db-dump` を書き換える。`actions/checkout` を追加し、`mktemp -d` の `GNUPGHOME` を作って `trap` の削除対象に加える。暗号化を `gpg --batch --trust-model always --recipient-file ops/backup/postall-backup.pub.asc --encrypt` に置き換え、アップロードの前に 7.2 の検査を実行する。`DUMP_PASSPHRASE` の参照を削除する。`actionlint` が通り、ファイル中に `DUMP_PASSPHRASE` と `--symmetric` が残っていないことを `grep` で確認する

## 8. ドキュメント

- [x] 8.1 `ARCHITECTURE.md` を更新する: 「3. 認証」に許可リストの判定位置と fail-closed を書く。トークン保管の記述を「ブラウザはリフレッシュトークンを origin の `localStorage` に置き、XSS への備えは無害化と CSP で行う」に改め、表の記述と揃える。「9. 多層防御」に許可リスト・CSP・削除時の本文消去・バックアップの公開鍵暗号化を追記し、「10. 可用性とスケール」のバックアップの記述を公開鍵方式に改める。「ブラウザは永続ストレージへ平文で置かない」の文言が残っていないことを `grep` で確認する
- [x] 8.2 `DEPLOYMENT.md` を更新する: 環境変数の表に `ALLOWED_AUTH_SUBJECTS`（Config、Supabase のユーザー ID のカンマ区切り、未設定で全員拒否）を追加し、GitHub secrets の表から `DUMP_PASSPHRASE` を外す。バックアップ鍵の生成・保管・復旧（`gpg --decrypt ... | gunzip`）の手順を追加する。チェックリストに「GitHub / Supabase / Vercel の各アカウントで 2FA を有効化（パスキー推奨）」と「`ALLOWED_AUTH_SUBJECTS` を設定済み」を追加する。旧アーティファクトの削除手順（`gh api` で `postall-db-dump-*` を列挙して削除）も追加する
- [x] 8.3 `SETUP_GUIDE.md` の §9（招待制）に「Studio で作成したユーザーの ID を `ALLOWED_AUTH_SUBJECTS` に追加し、再デプロイする」手順と、ローカル開発で `.env.local` に自分の ID を入れる手順を追加する。`.env.example` に `ALLOWED_AUTH_SUBJECTS=` を説明コメント付きで追加し、`README.md` の `DUMP_PASSPHRASE` への言及を公開鍵方式へ改める。リポジトリ全体で `DUMP_PASSPHRASE` の言及が archive と過去の plan 以外に残っていないことを `grep` で確認する

## 9. E2E fixture

- [x] 9.1 `frontend/e2e/mock.ts` の `installApiMock` に `accountNotAllowed: true` のオプションを追加する。サインイン済みの状態から、全 `/v1/*` に `403 {"code":"account_not_allowed"}` を返し、受けた要求を数えられるようにする（`mock:account-not-allowed`）。既存の E2E が回帰しないことを確認する
- [x] 9.2 `installApiMock` に、コードブロック・Mermaid 図・画像添付を 1 つのポストに含む初期状態を追加する（`mock:rich-content-post`）。画像添付のダウンロード URL は同一 origin のモック画像を指すようにする
- [x] 9.3 `frontend/playwright.config.ts` に、`VITE_E2E=true` でビルドしたものを `vite preview` で配信する webServer と、それを使う project を追加する（`build:csp-e2e`）。既存の `pwa` project の配信（`build:pwa-preview`）は変えない。`npx playwright test --list` で新しい project が認識されることを確認する
- [x] 9.4 Electron の E2E が、本番ビルドの `frontend/dist` を読み込めるようにする（`electron:built-dist`）。CI の electron job で、テストの前に `frontend` のビルドを行う step を追加し、その手順を確認する
- [x] 9.5 `frontend/e2e/fixtures/README.md` の表に、`mock:account-not-allowed`・`mock:rich-content-post`・`build:pwa-preview`・`build:csp-e2e`・`electron:built-dist` の fixture 名・作られる状態・使用する TP-ID・方式を登録する

## 10. E2E テスト実装（test-plan.md の TP と 1:1）

- [x] 10.1 TP-001（`@harden-sensitive-data-protection`, `@TP-001`）: `mock:account-not-allowed` でアプリを開くと、サインイン画面に許可されていない旨が出ること、チャネル・ポストが表示されないこと、端末のトークンが消えていることを検証する Playwright テストを `frontend/e2e/security.spec.ts` に実装する。`testMatch` を更新し、`npx playwright test --grep @TP-001` で通ることを確認する
- [x] 10.2 TP-002（`@harden-sensitive-data-protection`, `@TP-002`）: `mock:account-not-allowed` で、案内が 1 つだけ表示されること、サインイン画面に戻った後に新たな `/v1/*` 要求が送られないことを検証するテストを `security.spec.ts` に実装する。`--grep @TP-002` で通ることを確認する
- [x] 10.3 TP-003（`@harden-sensitive-data-protection`, `@TP-003`）: `build:pwa-preview` の `/` を取得し、CSP の `<meta>` の `script-src` に `'unsafe-inline'`・`'unsafe-eval'` が無いこと、`object-src 'none'`・`base-uri 'self'` があることを検証するテストを `pwa.spec.ts` に実装する。`--grep @TP-003` で通ることを確認する
- [x] 10.4 TP-004（`@harden-sensitive-data-protection`, `@TP-004`）: `build:csp-e2e` + `mock:signed-in-with-emojis` で、`securitypolicyviolation` の記録を仕込んだうえで、インライン `<script>` とイベントハンドラ属性付きの要素を挿入する。どちらも実行されず、`script-src` の違反が記録されることを検証するテストを実装する。`--grep @TP-004` で通ることを確認する
- [x] 10.5 TP-005（`@harden-sensitive-data-protection`, `@TP-005`）: `build:csp-e2e` + `mock:signed-in-with-emojis` で、許可していない origin への `fetch` が失敗し、`connect-src` の違反が記録されることを検証するテストを実装する。`--grep @TP-005` で通ることを確認する
- [x] 10.6 TP-006（`@harden-sensitive-data-protection`, `@TP-006`）: `build:csp-e2e` + `mock:rich-content-post` で、コードブロックのハイライト・Mermaid の SVG・添付画像が描画され、その間の `securitypolicyviolation` が 0 件であることを検証するテストを実装する。`--grep @TP-006` で通ることを確認する
- [x] 10.7 TP-007（`@harden-sensitive-data-protection`, `@TP-007`）: `electron:built-dist` で Electron を起動し、アプリシェルに CSP の `<meta>` があること、挿入したインラインスクリプトが実行されないこと、アプリシェルが表示されることを検証する `electron/test/csp.e2e.mjs` を実装する。テスト名とファイル先頭のコメントにタグを書き、`electron/package.json` の `test` に追加する。`cd electron && xvfb-run -a npm test`（macOS ではそのまま `npm test`）で通ることを確認する

## 11. 全体検証

- [x] 11.1 `cd backend && go vet ./... && go test ./...`、`cd frontend && npm run typecheck && npm run lint && npm test && npm run build && npm run test:e2e`、`cd electron && npm test`、`bash ops/backup/verify-dump-recipients.test.sh` がすべて通ることを確認し、ログを残す
- [x] 11.2 `bash scripts/check-test-plan.sh` と `openspec validate harden-sensitive-data-protection --strict` が通ることを確認する
- [x] 11.3 ローカルの Supabase スタック（`supabase start`）で API と web を起動する。自分の ID を `ALLOWED_AUTH_SUBJECTS` に入れた状態でサインインして操作できること、ID を外すとサインイン画面に案内が出ることを手動で確認する。ポストを削除した後、`psql` で当該行の `body` が空であることも確認する

## 12. 本番への適用（運用者作業、design.md の Migration Plan）

- [x] 12.1 【運用者】Vercel の Production 環境に `ALLOWED_AUTH_SUBJECTS` を設定する（現在の利用者の ID は Supabase Studio の Authentication > Users で確認する）。`vercel env ls production` に表示されることを確認する
- [x] 12.2 【運用者】マージ後に `migrate` workflow で `00016` を適用し、続けて `deploy` workflow でデプロイする。許可されたアカウントで一覧が表示されること、ブラウザの DevTools に CSP 違反が出ないこと、本番の応答ヘッダーに `frame-ancestors 'none'` があること（`curl -sI`）を確認する
- [x] 12.3 【運用者】`ops` workflow を `workflow_dispatch` で実行し、生成されたアーティファクトをローカルで `gpg --decrypt | gunzip | head` して、中身が読めることを確認する
- [x] 12.4 【運用者】12.3 の成功を確認してから、切り替え前の `postall-db-dump-*` アーティファクトを削除し、GitHub secrets から `DUMP_PASSPHRASE` を削除する。`gh api repos/sudabon/PostAll/actions/artifacts` に旧アーティファクトが残っていないことを確認する
- [x] 12.5 【運用者】GitHub・Supabase・Vercel の各アカウントで 2FA（パスキー推奨）が有効であることを確認し、DEPLOYMENT.md のチェックリストに記録する
