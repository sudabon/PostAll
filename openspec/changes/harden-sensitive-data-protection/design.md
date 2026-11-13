## Context

動機は proposal.md の Why を参照。ここでは、設計を縛る現状だけを挙げる。

- 認可は `backend/internal/auth/middleware.go` の 1 か所に集まっている。JWT の検証に通った `sub` は、そのまま `store.ResolveByAuthSubject`（`backend/internal/store/users.go:21`）で `users` 行に解決され、行が無ければ作られる。サービス層は `Principal` しか見ない。チャネルには所有者の概念が無く、認可済みのユーザーは全データを読める。
- 論理削除は `SoftDeletePost`（`backend/internal/store/queries/posts.sql:20`）の 1 本の UPDATE で行う。応答と取得では、`fromPost` が削除済みの本文を空にして返している。DB の `body` は残る。検索（`search.sql`）は `deleted_at is null` で除外している。削除済みポストに付いた添付は、回収処理の `MarkReapableAttachmentsPending` が回収対象にする。ダウンロードも `DeletedAt` を見て 404 を返す。
- `db-dump`（`.github/workflows/ops.yml`）は `supabase db dump --data-only --schema public` を gzip し、`gpg --symmetric` で暗号化する。リポジトリは PUBLIC で、アーティファクトはサインインした任意の GitHub ユーザーが取得できる。
- フロントは Vite でビルドした単一の `dist` を、Vercel（web サービス）と Electron（`app://localhost/` のプロトコルハンドラ）の両方が配信する。`index.html` にインラインスクリプトは無い。PWA の登録も `injectRegister: false` で、インラインの登録スクリプトを使っていない。シンタックスハイライトは `shiki` の既定バンドルを使っており、WASM の正規表現エンジンが動く。Mermaid は `securityLevel: 'strict'` で SVG を生成し、`dangerouslySetInnerHTML` で差し込んでいる。
- Electron のトークン保管は `electron/main.mjs` の `loadStores` / `saveSecrets` にあり、`safeStorage.isEncryptionAvailable()` が false なら平文で読み書きする。

## Goals / Non-Goals

**Goals:**

- 認可の判定を、Supabase ダッシュボードの設定から独立させる。どちらか片方の誤設定だけでは突破されないようにする。
- 本文の消去を DB の書き込みの時点で確定させる。表示層での隠蔽に頼らない。
- CI の秘密情報が漏れても、バックアップが読めない状態にする。
- CSP は Web と Electron で 1 つの定義を共有し、ずれる箇所を作らない。

**Non-Goals:**

- proposal.md の Non-goals に加えて、次の 3 点も扱わない。
- Realtime（`realtime.messages`）の購読を許可リストで絞ること。購読者が受け取れるのはイベント ID だけで、本文は API でしか取れない。その API は許可リストで閉じる。
- Trusted Types（`require-trusted-types-for 'script'`）の導入。Mermaid と Shiki が `dangerouslySetInnerHTML` を使うため、対応するポリシーの設計が別途必要になる。
- 削除済みポストの添付を、論理削除と同時に Storage から消すこと。ダウンロードは削除済みの時点で 404 になる。実体は既存の回収処理（最長 6 時間間隔）で消える。

## Decisions

### D1. 許可リストは環境変数で渡し、認証ミドルウェアで判定する

- `ALLOWED_AUTH_SUBJECTS` に、カンマ区切りで Supabase のユーザー ID（JWT の `sub`、UUID）を列挙する。前後の空白と空要素は無視し、小文字に正規化する。読み込みは `cmd/postall-server/main.go` で行い、`httpapi.Config.AllowedAuthSubjects []string` として渡す。
- `auth.Middleware` に許可集合を渡す。順序は「JWT 検証 → 許可判定 → `ResolveByAuthSubject`」とする。許可判定を `users` 行の解決より前に置くことで、拒否したアカウントの行が作られないことを構造で保証する。
- 拒否は `403 {"code":"account_not_allowed","message":"このアカウントでは利用が許可されていません"}` で返す。添付の 403（`forbidden`）とクライアントが区別できるよう、専用のコードを使う。
- 集合が空なら全員を拒否する（fail-closed）。起動自体は止めない。起動を止めると `/health` と `/internal/*` まで 500 になり、keep-alive が途切れて Supabase Free の自動 pause を招くからである。代わりに起動時に `slog.Warn` で設定漏れを記録する。
- 比較対象は `sub` とする。`email` は変更できるうえ、identity linking の挙動に左右されるので使わない。招待の手順では Supabase Studio で先にユーザーを作るため、初回サインインの前に `sub` が分かる。

検討した代替案:

- **`users` の自動作成をやめ、事前登録された行だけを通す**: 許可の定義が DB の行になり、追加には SQL 操作が要る。仕様の「初回サインインで登録」とも衝突する。環境変数のほうが変更の痕跡が残り（Vercel の環境変数の履歴）、無効化も即時にできる。
- **許可リスト用のテーブルを作る**: 管理 UI が無い今は、環境変数より操作が重くなるだけで得るものが無い。

### D2. クライアントは `account_not_allowed` を受けたら即座にサインアウトする

- `ApiClient` に、`onAccountNotAllowed` のコールバックを受け取る口を設ける。`request` が 403 かつ `code === 'account_not_allowed'` を受け取ったら、コールバックを呼んでから `ApiError` を投げる。
- `AuthProvider` はコールバックで `signOut()` を呼び、`error` に案内文を入れる。`SignInScreen` は既存の `error` 表示の経路でこれを示す。案内文は、サインアウト後の再描画で消えないよう、サインイン画面を離れるまで保持する。
- 判定を各 hook ではなく `ApiClient` に置くのは、どの API が最初に拒否を受けても同じ経路で処理するためである。TanStack Query が並列に投げた要求が、同時に複数の 403 を受け得る。そのため `signOut` は冪等にし、2 回目以降の呼び出しは何もしない。
- `api/openapi.yaml` に共通レスポンス `AccountNotAllowed`（403）を定義し、認可が必要な全オペレーションから参照する。`Error.code` は自由文字列のままで、enum は追加しない。

### D3. 本文の消去は `SoftDeletePost` の同じ UPDATE で行う

- `SoftDeletePost` に `body = ''` を加える。消去が論理削除と同じ文で確定するため、トランザクションの境界を新たに考えなくてよい。PGroonga の索引は UPDATE に追従する。
- `edited_at` はそのまま残す。表示上の意味（編集されたことがある）を変えないためである。
- 既存の削除済み行は、マイグレーション `00016_erase_deleted_post_bodies.sql` で `update posts set body = '' where deleted_at is not null and body <> ''` を実行して消す。Down は何もしない（消した本文は戻せない）。Down が no-op であることはコメントに明記する。
- 応答側の `fromPost` が削除済みの本文を空にする処理は残す。DB と表示の二重の保証になる。

検討した代替案:

- **猶予期間の後に、定期実行で本文を消す**: 「削除の取り消し」の機能が無い以上、猶予を設ける理由が無い。猶予を設ければ、その間はバックアップに残ってしまう。
- **ハードデリート**: スレッドの親が消えると、返信の `thread_root_id` の参照が壊れる。添付のトリガーやイベントの意味も変わり、影響が大きい。

### D4. バックアップは、リポジトリに置いた公開鍵への GPG 暗号化にする

- 運用者はローカルで、`gpg --quick-gen-key 'PostAll backup' future-default default never` で鍵を作る（署名・認証用の ed25519 と、暗号化用サブ鍵の cv25519 ができる。`ed25519/cert,sign+cv25519/encr` の書式は GnuPG 2.4.4 で `Invalid value` になる）。公開鍵だけを `ops/backup/postall-backup.pub.asc` としてコミットする。秘密鍵はパスワードマネージャなど CI の外に保管する。失うとバックアップを戻せなくなるので、保管先を 2 か所にする。
- ワークフローは一時的な `GNUPGHOME` を `mktemp -d` で作り、`gpg --batch --trust-model always --recipient-file ops/backup/postall-backup.pub.asc --encrypt` で暗号化する。`--recipient-file` を使うのでキーリングへの import は要らない。`--trust-model always` を付けるのは、鍵の正しさをキーリングの信頼モデルではなく、リポジトリへのコミット（レビュー経路）で担保するためである。
- 暗号化の後に `gpg --list-packets` で成果物を検査する。`:pubkey enc packet:` の keyid が公開鍵ファイルの暗号化サブ鍵と一致すること、`:symkey enc packet:` が無いことを確かめる。満たさなければ、アップロードせずにジョブを失敗させる（spec の「暗号化の宛先を検証する」）。
- 検査は `ops/backup/verify-dump-recipients.sh <encrypted> <public-key>` に切り出し、ワークフローから呼ぶ。単体試験 `ops/backup/verify-dump-recipients.test.sh` では、使い捨ての鍵で「公開鍵宛て（合格）」「共通鍵（不合格）」「別の鍵宛て（不合格）」の 3 種を作り、終了コードを確かめる。この試験は CI の `ci` workflow で走らせる。
- 平文と gzip は、既存の `trap` で `$RUNNER_TEMP` から消す。`GNUPGHOME` も同じ `trap` で消す。
- `DUMP_PASSPHRASE` は参照をやめ、新方式で 1 回成功したら GitHub secrets から削除する。旧方式のアーティファクトは、`gh api repos/sudabon/PostAll/actions/artifacts` で名前 `postall-db-dump-*` かつ切り替え前に作られたものを列挙して削除する。

検討した代替案:

- **`age` を使う**: 鍵管理は簡単になるが、runner への導入が要る。既存の復旧手順（`gpg --decrypt`）からの変更も大きくなる。GPG は runner に同梱されている。
- **非公開の保管先（private リポジトリ・S3 など）へ移す**: 有効ではあるが、新しい資格情報を CI に置くことになる。公開鍵暗号にすれば、保管先が公開でも機密性が保たれる。保管先は、必要になった時点で非公開にしてもよい。
- **パスフレーズを強くするだけ**: CI に復号鍵が残る構造は変わらない。

### D5. CSP は Vite のビルドプラグインで `<meta>` として差し込む

- `frontend/vite.config.ts` に `apply: 'build'` の小さなプラグインを足す。`transformIndexHtml` で `<head>` の先頭に `<meta http-equiv="Content-Security-Policy">` を入れる。開発サーバ（HMR がインラインスクリプトを使う）には適用しない。
- ポリシーは次のとおり。`<supabase>` はビルド時の `VITE_SUPABASE_URL` の origin で、`<supabase-ws>` はその `wss:` 版である。`<supabase-storage>` は添付の署名付き URL の発行元で、`https://<ref>.supabase.co` から `https://<ref>.storage.supabase.co` を導く（S3 エンドポイントがこのホスト名を使い、ブラウザは XHR の PUT と `fetch` でここへ直接通信するため）。ホスト名が `*.supabase.co` でない場合（ローカルの `http://127.0.0.1:54321` など）は、Storage も同じ origin なので追加しない。

  ```
  default-src 'self';
  script-src 'self' 'wasm-unsafe-eval';
  style-src 'self' 'unsafe-inline';
  img-src 'self' data: blob: https: [<http-origins>];
  font-src 'self' data:;
  connect-src 'self' <supabase> <supabase-ws> [<supabase-storage>] [<api-origin>];
  worker-src 'self';
  manifest-src 'self';
  object-src 'none';
  base-uri 'self';
  form-action 'self'
  ```

- `'wasm-unsafe-eval'` は、Shiki の WASM 正規表現エンジンのためのものである。これで許されるのは WASM のコンパイルだけで、JS 文字列の評価（`eval` / `new Function`）は許されない。
- `style-src 'unsafe-inline'` は、Mermaid が SVG 内に出す `<style>` と、Shiki が出す `style` 属性のためのものである。スクリプトの実行は `script-src` で閉じているので、許容する。
- `img-src https:` は、本文中の外部画像（Markdown の `![]()`）を壊さないためのものである。画像の読み込みではスクリプトは実行されない。`<http-origins>` は `connect-src` のうち `http:` の origin（ローカルの Supabase・API）で、ローカルで本番ビルドを動かしたときに添付画像を表示するためだけに足す。本番（https）では追加されない。
- `VITE_SUPABASE_URL` が絶対 URL として解釈できない場合は、ビルドを失敗させる。
- 接続先はビルド時の値で固定される。設定画面で実行時にビルド時と異なる Supabase / API の URL を入れても、CSP により通信できない。spec の「接続先を自オリジンと許可した提供元に限る」に従う意図した挙動である。
- E2E の `pwa` project のビルドには、既存の PKCE テストが実行時に使う `https://auth.example.test` を `VITE_SUPABASE_URL` として渡す。CSP の導入後は、ビルド時に許可した origin にしかトークン交換の `fetch` が届かないためである。
- `VITE_API_BASE_URL` が別オリジンを指すとき（ローカルで API を別ポートに立てる場合）だけ、その origin を `connect-src` に加える。`VITE_SUPABASE_URL` が未設定なら、Supabase 側の origin を出さない（E2E の preview ビルドが該当する）。
- `frame-ancestors` は `<meta>` では効かないので、`vercel.json` の `Content-Security-Policy: frame-ancestors 'none'` ヘッダーを残す。ヘッダーと `<meta>` の 2 つのポリシーは積集合として効く。
- Electron は同じ `dist/index.html` を `app://localhost/` で読み込むので、同じ `<meta>` が適用される。この場合 `'self'` は `app://localhost` を指す。API は同じスキームのプロキシ経由で、Storage への PUT はメインプロセスを経由するため、追加の許可は要らない。

検討した代替案:

- **`vercel.json` のヘッダーで全ポリシーを配る**: Electron には届かず、`electron/main.mjs` でも同じポリシーを持つことになる。加えて、Supabase のプロジェクト URL を `vercel.json` に直書きする必要がある。定義が 2 か所に割れる。
- **nonce 方式**: 静的配信なので、要求ごとに nonce を作れない。インラインスクリプトも無いので不要である。
- **Shiki を JavaScript 正規表現エンジンに替えて `'wasm-unsafe-eval'` を外す**: 対応言語の互換性の検証が要る。得られる安全性の差も小さいので、本 change では行わない。

### D6. Electron のトークン保管を、テスト可能なモジュールへ切り出す

- `electron/secret-store.mjs` に、`createSecretStore({ safeStorage, fs, path })` を置く。`load()` / `save(map)` / `clear()` を持たせる。`main.mjs` はこれを呼ぶだけにする。
- `save`: `isEncryptionAvailable()` が false なら、ファイルへ書かない。既存のファイルがあれば削除し、`console.warn` を 1 回だけ出す。メモリ上の `secrets` の Map は残すので、そのプロセスの間はサインイン状態が続く。
- `load`: `isEncryptionAvailable()` が false なら、トークンとしては読まずに空を返す。ただし内容が JSON として読める（＝過去の平文保存）ファイルは削除する（spec の「過去に暗号化せずに保存したトークンが残っている」は保管領域の可否を問わないため）。暗号文は、保管領域が戻ったときに読めるよう残す。true なら `decryptString` を試す。失敗したら、内容が JSON として読めるか（＝過去の平文保存か）を調べる。読めた場合は内容を使わずにファイルを削除する。読めない場合（壊れた暗号文）も、空を返してファイルを削除する。
- テストは `node --test` で `electron/test/secret-store.test.mjs` に置く。`safeStorage` と `fs` は偽物を注入する。

### D7. ドキュメントと運用チェックリスト

- ARCHITECTURE.md の「3. 認証」の「ブラウザは永続ストレージへ平文で置かない」を、仕様（`authentication` の「トークンの安全な保管」）に合わせて改める。「リフレッシュトークンを origin の `localStorage` に置く。XSS への備えは CSP（§9）と無害化で行う」とする。「9. 多層防御」には、許可リスト・CSP・本文消去・バックアップ暗号化を追記する。
- DEPLOYMENT.md には、環境変数の表に `ALLOWED_AUTH_SUBJECTS` を追加する。GitHub secrets の表からは `DUMP_PASSPHRASE` を外す。鍵の生成・保管・復旧（`gpg --decrypt`）の手順も追加する。チェックリストには「GitHub / Supabase / Vercel の各アカウントで 2FA を有効化（パスキー推奨）」を追加する。SETUP_GUIDE.md の招待手順（§9）には、「作成したユーザーの ID を `ALLOWED_AUTH_SUBJECTS` に追加して再デプロイ」を加える。

## Risks / Trade-offs

- [`ALLOWED_AUTH_SUBJECTS` を設定し忘れてデプロイすると、全員が 403 になる] → fail-closed は意図した挙動である。起動ログに警告を出す。DEPLOYMENT.md のデプロイ前チェックに項目を加える。Vercel に環境変数を入れてから、本 change をデプロイする順序を Migration Plan で固定する。
- [CSP がライブラリの挙動とぶつかり、Mermaid や Shiki の描画が壊れる] → PWA の E2E（preview ビルド）で、コードブロック・Mermaid・画像を描画した状態の `securitypolicyviolation` イベントが 0 件であることを検査する。Electron でも同じ確認を手動で行う。
- [バックアップの秘密鍵を失い、復旧できなくなる] → 保管先を 2 か所にすることを手順に書く。切り替えた直後に、実際のアーティファクトを 1 回ローカルで復号・展開する検証を、タスクに含める。
- [切り替え前の旧アーティファクトは、最長 30 日、旧パスフレーズで開ける] → 新方式が 1 回成功した時点で、旧アーティファクトを削除し、`DUMP_PASSPHRASE` も削除する。旧パスフレーズが漏れていた場合に備え、削除を先送りしない。
- [削除済みの本文は、削除前に取ったバックアップには最長 30 日残る] → 仕様で対象外と明記した。即時に消す必要がある場合は、旧アーティファクトの削除手順を使う。
- [許可リストから外したアカウントの `users` 行と過去の投稿は残る] → 作成者の参照を壊さないため、意図して残す。アクセスは即時に止まる。

## Migration Plan

1. 運用者が公開鍵・秘密鍵を作り、秘密鍵を CI の外に 2 か所保管する。
2. Vercel の Production 環境に `ALLOWED_AUTH_SUBJECTS` を設定する（現在の利用者の `sub` を Supabase Studio で確認する）。この時点では旧コードなので影響は無い。
3. PR をマージし、`migrate` workflow で `00016` を適用する。適用済みでも旧コードは動く（`body` を空にするだけ）。
4. `deploy` workflow で API と web をデプロイする。デプロイ後に、許可された自分のアカウントで一覧が取れること、ブラウザの DevTools に CSP 違反が出ないことを確認する。
5. `ops` workflow の `db-dump` を `workflow_dispatch` で 1 回走らせる。生成物をローカルで `gpg --decrypt | gunzip | head` して中身を確かめる。
6. 旧アーティファクトを削除し、GitHub secrets から `DUMP_PASSPHRASE` を削除する。
7. GitHub / Supabase / Vercel の 2FA が有効であることを確かめ、チェックリストに記録する。

ロールバック:

- **API**: 直前のデプロイへ戻す（Vercel の Instant Rollback）。許可リストを一時的に止めたい場合も、コードを戻す。環境変数を空にすると全員拒否になるので、空にして止めることはしない。
- **CSP**: web を直前のデプロイへ戻す。
- **`00016`**: 戻せない（消した本文は戻らない）。Down は no-op とする。
- **バックアップ**: ワークフローを戻すと共通鍵方式に戻るが、`DUMP_PASSPHRASE` を消した後は再登録が要る。手順 6 は、手順 5 の確認が済むまで行わない。
