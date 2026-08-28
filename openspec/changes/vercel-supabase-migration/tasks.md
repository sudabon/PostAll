## 1. 前提の検証（他のすべてに先行する）

- [x] 1.1 Supabase プロジェクトを **Free プラン**で作成し、接続文字列（ダイレクト / Supavisor トランザクションモード 6543）、Auth の JWKS URL を控える
- [x] 1.2 **`create extension pgroonga` が Free プランで通ることを確認する。** 通らない場合は先へ進まず、Pro への引き上げ / `pg_trgm` へ後退（最小検索文字数を 3 文字へ引き上げ、`full-text-search` の要件変更が必要）/ 索引なしの `LIKE` のいずれを採るかを決める
- [x] 1.3 `create extension pgcrypto` が通ることを確認する
- [x] 1.4 Supabase Storage の S3 互換エンドポイントとアクセスキーを控える（Free プランで発行できることは確認済み）
- [x] 1.5 Vercel プロジェクトを **Hobby プラン**で作成し、リポジトリ（個人アカウント所有であること）を接続する。本番昇格はまだ行わない
- [x] 1.6 `cmd/postall-server/main.go` の待受アドレス決定を、`PORT` が設定されていればそれを優先する形に変える
- [x] 1.7 ルートに `vercel.json` を追加し、`services`（`web` = `frontend/` + `framework: vite` + `outputDirectory: dist`、`api` = `backend/` + `framework: go` + `entrypoint: cmd/postall-server/main.go` + `buildCommand: go build -o server ./cmd/postall-server`）と rewrite（`/v1/*` と `/health` を api、残りを web）を定義する
- [ ] 1.8 **`services` が Hobby で使えることを確認する。** 使えない場合はフロント / API を 2 プロジェクトに分け、フロント側 `vercel.json` の rewrite で `/v1/*` を API プロジェクトへプロキシする構成へ切り替える（同一オリジンは維持されるので CORS は不要のまま）
- [ ] 1.9 プレビューデプロイで `/health`（DATABASE_URL 未設定）が 200 を返し、ルート URL が PWA を返すことを確認する。**ここが通らない場合は以降を進めず、設計を見直す**

## 2. マイグレーションの書き換え

- [x] 2.1 `pg_bigm` 拡張と `posts_body_bigm` 索引を落とし、`pgroonga` 拡張と `posts using pgroonga (body pgroonga_text_regexp_ops_v2)` 索引を作るマイグレーションを追加する
- [x] 2.2 `postall_notify_change_event()` を `pg_notify` から `realtime.send()`（トピック `postall:events`、private、payload はイベント ID のみ）へ差し替えるマイグレーションを追加する
- [x] 2.3 `users.cognito_sub` を `auth_subject` へ改名するマイグレーションを追加し、一意制約と索引名も揃える
- [x] 2.4 `internal/store/schema.sql` を新しいスキーマへ合わせ、`make -C backend generate`（sqlc）を通す
- [x] 2.5 空の Supabase データベースへ全マイグレーションを適用し、エラーなく完了することを確認する

## 3. 全文検索の PGroonga 化

- [x] 3.1 `LIKE` パターンのエスケープヘルパ（`%` `_` `\`）を Go 側に実装し、単体テストを書く
- [x] 3.2 `internal/store/queries/search.sql` の 2 クエリから `likequery()` を外し、アプリ側で組んだパターンを受ける形へ書き換える
- [x] 3.3 `internal/search/service.go` の呼び出しをエスケープヘルパ経由に変え、最小 2 文字の検証はそのまま維持する
- [x] 3.4 `internal/testutil/postgres.go` の testcontainers イメージを PGroonga 入りの PostgreSQL へ切り替える
- [x] 3.5 `internal/search/schema_integration_test.go` と検索の統合テストを通す。日本語 2 文字・語の途中一致・大文字小文字非依存・特殊文字を含む検索語のケースを追加する
- [x] 3.6 同一のポスト集合に対し、PGroonga 索引を張った状態と素の `LIKE`（索引なし）とで検索結果が一致することを確認するテストを追加する（索引がセマンティクスを変えていないことの担保）

## 4. 常駐処理の除去

- [x] 4.1 `cmd/postall-server/main.go` から起動時の goose マイグレーション実行を削除する
- [x] 4.2 `internal/httpapi/event_broker.go` を削除し、`internal/httpapi/events.go` から SSE ハンドラ（`streamChangeEvents`）を削除する。`GET /v1/events` のポーリング経路は残す
- [x] 4.3 添付リーパーの常駐 goroutine（`internal/httpapi/server.go` の `reapLoop`）を削除し、共有シークレットで保護した内部エンドポイントから `Reap` を呼ぶ形にする
- [x] 4.4 `vercel.json` に添付回収の Cron（Hobby の制約により日次）を追加し、シークレットは環境変数で与える
- [x] 4.5 `internal/httpapi/server.go` の `Close()` が不要になった経路を整理し、`main.go` のシャットダウンで残るリソース（pgxpool）が確実に解放されることを確認する
- [x] 4.6 `internal/httpapi/server.go` の `pgxpool` を明示設定する（`MaxConns` を 1〜2、`MaxConnIdleTime` を短縮、prepared statement キャッシュの無効化）
- [x] 4.7 PgBouncer のトランザクションモードを挟んだ統合テストを 1 本追加し、prepared statement 起因のエラーが出ないことを確認する

## 5. オブジェクトストレージの差し替え

- [x] 5.1 `aws-sdk-go-v2` の `PresignPut` が `content-length` を署名対象に含めているかを確認し、含めた場合に Supabase Storage が署名不一致を正しく拒否することを検証する（宣言値と実バイト数の整合は保証されないため、完了時の `Head` 検証は必ず残す）
- [x] 5.2 `internal/blob/s3.go` のエンドポイントと資格情報を Supabase Storage の S3 互換エンドポイントへ向ける。5.1 の結果に応じて `ContentLength` の扱いを決める
- [x] 5.3 添付用バケットを非公開で作成し、署名なしの直接アクセスが内容を返さないことを確認する
- [x] 5.4 `internal/httpapi/attachments_integration_test.go` を通し、アップロード開始 → 直接 PUT → 完了通知 → ダウンロードの一連が成立することを確認する
- [x] 5.5 `POST /v1/attachments/uploads` の応答（url + headers）が変わるかを判定し、変わる場合のみ `api/openapi.yaml` を更新する

## 6. 絵文字の Storage 移行

- [x] 6.1 絵文字用バケットを非公開で作成する
- [x] 6.2 `emoji-sync` を、`emoji/` の png を Storage へアップロードしたうえで DB を更新する形に変える。チェックサム一致時は再アップロードしない
- [x] 6.3 `internal/httpapi/emojis.go` のローカル FS 配信を削除し、`If-None-Match` が checksum と一致すれば 304、そうでなければ署名付き GET URL へ 302 を返す形にする
- [ ] 6.4 フロントエンドの `fetch` → `blob()` 経路（`frontend/src/api/client.ts:122`）が 302 追随で成立することを実機で確認する
- [x] 6.5 認可情報なしの要求が絵文字画像を取得できないこと、未登録ショートコードが 404 になることを統合テストで確認する

## 7. 認証の Supabase Auth 化

- [x] 7.1 Supabase Auth を有効化し、非対称署名鍵（ES256）を設定する。Redirect URL 許可リストへ `postall://auth/callback` と本番オリジンの `/auth/callback` を登録する
- [x] 7.2 `internal/auth/verifier.go` の JWKS URL・鍵の型判定（RSA → ECDSA）・issuer / audience / role の検証を Supabase Auth 向けに差し替える。JWKS キャッシュ・遅延リフレッシュ・singleflight・ネガティブキャッシュの構造は維持する
- [x] 7.3 `internal/auth/verifier_test.go` を ES256 の鍵とクレームで書き換え、キャッシュ・鍵ローテーション追随・未知 kid の繰り返し提示の各テストを通す
- [x] 7.4 `internal/store/users.go` と `queries.sql` のユーザー解決を、`select` 優先・不在時のみ `insert` する形に変える
- [x] 7.5 `internal/auth/middleware.go` と `Principal` のフィールド名を `auth_subject` へ合わせる
- [x] 7.6 `internal/auth/middleware_test.go` と認証周りの統合テストを通す

## 8. API 契約とコード生成

- [x] 8.1 `api/openapi.yaml` から `GET /v1/events/stream` を削除する
- [x] 8.2 `make generate` を実行し、`backend/internal/api/`、`frontend/src/api/schema.d.ts`、`mobile/lib/api/generated/` の生成物を更新する
- [ ] 8.3 CI の `openapi-generated` ジョブ（生成物ドリフト検出）が通ることを確認する

## 9. フロントエンドの追随

- [x] 9.1 `src/auth/pkce.ts` と `src/auth/AuthProvider.tsx` を Supabase Auth のフローへ書き換える。ブラウザは `/auth/callback`、Electron は `postall://auth/callback` という現行の分岐を維持する
- [x] 9.2 `src/state/settings.ts` と `src/components/settings/SettingsDialog.tsx` の Cognito 設定項目を Supabase の設定項目（プロジェクト URL、publishable key）へ差し替える
- [x] 9.3 `src/api/sse.ts` と `src/api/client.ts` の SSE 経路を削除する
- [x] 9.4 `src/hooks/useChangeSync.ts` の接続管理を Supabase Realtime の `postall:events` 購読へ差し替える。通知を受けたら `GET /v1/events?after=` で差分を回収する既存ロジックはそのまま使う
- [x] 9.5 Realtime へ接続できない場合に `GET /v1/events?after=` の定期取得へ退避する経路を確認する
- [x] 9.6 トークンをブラウザの永続ストレージへ平文で保存しないという既存の制約が保たれていることを確認する
- [x] 9.7 `npm run typecheck` / `lint` / `test` / `test:e2e` を通す

## 10. iOS の追随

- [x] 10.1 `lib/auth/cognito.dart` を Supabase Auth のフローへ書き換える。`FlutterWebAuth2` と `postall` コールバックスキームは維持する
- [x] 10.2 `lib/api/http_postall_api.dart` の SSE 購読（dio の stream）を削除する
- [x] 10.3 `lib/state/sync.dart` を Supabase Realtime 購読へ差し替える。バックグラウンド復帰時に `GET /v1/events?after=` で回収する既存の挙動は維持する
- [x] 10.4 `lib/state/settings.dart` の設定項目と既定 API ベース URL を新しい構成に合わせる
- [x] 10.5 トークンを Keychain へ保管する既存の挙動が保たれていることを確認する
- [x] 10.6 `flutter analyze` / `flutter test` を通す

## 11. Electron の追随

- [x] 11.1 認証フローの変更に追随する。`app://` によるローカル配信と `postall://` ディープリンク、`safeStorage` によるトークン保管は変更しない
- [ ] 11.2 パッケージ済みアプリでサインインからタイムライン表示までを実機確認する

## 12. 配信設定と運用ワークフロー

- [x] 12.1 `vercel.json` に静的アセットのキャッシュ指示（`/assets/*` は immutable、`/sw.js` は `no-cache` + `Service-Worker-Allowed: /`、`/manifest.webmanifest` は `no-cache`）と SPA フォールバックを追加する
- [ ] 12.2 `/v1/*` の存在しないパスがアプリシェルではなく API のエラー応答を返すことを確認する
- [x] 12.3 手動 GitHub Actions にマイグレーション適用ジョブを追加する（Session プール接続で実行し、デプロイとは別に起動する）
- [x] 12.4 手動マイグレーション成功後に `emoji-sync` を実行するジョブを追加する
- [ ] 12.5 環境変数（Supabase の URL / キー / 接続文字列、Storage のバケット名と資格情報、Cron のシークレット）を Vercel のプロジェクト設定へ登録する
- [x] 12.6 Supabase の `realtime.messages` に RLS ポリシーを設定し、認証済みユーザーのみが `postall:events` を購読でき、匿名では購読できないことを確認する。DB 側トリガーの `private` フラグとクライアント側チャンネルの `private` 設定が一致していることを確認する
- [x] 12.7 GitHub Actions に 6 時間ごとの schedule ジョブを追加し、添付回収の内部エンドポイントを叩く。これが Supabase Free の無操作 pause 回避（keep-alive）も兼ねる
- [x] 12.8 GitHub Actions に日次の `supabase db dump` ジョブを追加し、成果物をアーティファクトとして保持する。失敗はワークフローの失敗として表面化させる
- [x] 12.9 エクスポートしたダンプから新しいデータベースを構築し、チャネル・ポスト・添付メタデータが復元されることを一度確認する
- [x] 12.10 データベースサイズ（500 MB）と Storage 容量（1 GB）の使用量の確認方法を運用メモに残す

## 13. 公開

- [ ] 13.1 Vercel を本番昇格する
- [ ] 13.2 `memo.sudabon.com` の DNS の TTL を短くしたうえで、Vercel へ向け直す。証明書が自動発行されることを確認する
- [ ] 13.3 サインイン、投稿、編集、論理削除、スレッド返信、添付のアップロードとダウンロード、絵文字リアクション、全文検索、他クライアントへの変更反映を 3 クライアントすべてで確認する
- [ ] 13.4 Realtime を切断した状態で `GET /v1/events?after=` のポーリングへ退避し、変更が反映されることを確認する
- [ ] 13.5 添付回収の定期実行が動き、Supabase プロジェクトが pause されないことを 1 週間観察する

## 14. 旧構成の撤去

- [x] 14.1 `infra/` 一式（`docker-compose.yml`、Nginx 設定、Certbot スクリプト、自己署名証明書、PostgreSQL の Dockerfile、SSE 検証ハーネス）を削除する
- [x] 14.2 `backend/Dockerfile` とルート `Makefile` の `test-sse-proxy` ターゲットを削除する
- [x] 14.3 `README.md` の前提・ローカル起動・AWS リソース表・開発コマンド・運用メモを新しい構成へ書き直す。PGroonga 索引の再作成手順を運用メモに残す
- [x] 14.4 `.github/workflows/ci.yml` から不要になったジョブや手順を整理する
- [ ] 14.5 動作確認の完了後、AWS の Cognito ユーザープールと S3 バケット、および旧 VPS を破棄する

## 15. PR #2 レビュー指摘の修正

- [x] 15.1 DB ダンプを gzip 圧縮後に GPG で暗号化し、10 MiB 上限・30 日保持で暗号化済みファイルだけを Artifact へ保存する。復元手順、`DUMP_PASSPHRASE`、Actions storage の `$0` 予算設定を README に記載する
- [x] 15.2 GitHub OAuth を Supabase Auth で有効化し、Web / Electron / iOS の認可 URLへ `provider=github` を追加する。既存 URL builder の呼び出し互換性を保った回帰テストを追加する
- [x] 15.3 Supabase Auth の signup を無効化し、同じ検証済みメールの既存ユーザーへ GitHub identity をリンクする初期設定を README に記載する
- [x] 15.4 Web と iOS の Realtime を非同期 token provider に切り替え、切断時はポーリングを続けながら指数バックオフで最新トークンによる再接続を行う。既存の公開 API は維持する
- [x] 15.5 iOS で Realtime 購読失敗中の接続状態を `degraded` として表示し、ポーリング成功で `online` に戻さない回帰テストを追加する
- [x] 15.6 Realtime 通知トリガーの best-effort 例外を PostgreSQL warning に記録し、RLS を `postall:events` の broadcast SELECT だけに限定する。README の手動 SQL も揃える
- [x] 15.7 PGroonga の一致テストで索引利用を強制・検証し、`_` と `\\` のケースを加える。00008 の Down は `pg_bigm` 索引を復元できない環境で安全に失敗させる
- [x] 15.8 `emoji-sync` が DB 復元後の欠損オブジェクトを再アップロードする回帰テストを追加する
- [x] 15.9 絵文字画像の 304 判定を Storage `Head` 後へ移し、302 のキャッシュを署名期限より短い 60 秒にする回帰テストを追加する
- [x] 15.10 E2E 専用 `postall:change-signal` リスナーを development / test mode に限定する
- [x] 15.11 対象テストを修正ごとに実行し、最後に Go build/vet/test、frontend typecheck/lint/test、Flutter analyze/test、可能なら Docker 統合テストを実行する
- [x] 15.12 既存 Artifact と repository Actions secrets を確認する（2026-08-27 時点でどちらも 0 件。削除・ローテーション対象なし）

## 16. PR #2 追加確認事項の修正

- [x] 16.1 `GET /v1/events?after=latest` で履歴を再生せず現在の数値カーソルを返し、従来の数値カーソルを維持する
- [x] 16.2 `change_events` を30日保持とし、最新ウォーターマークを残す共有シークレット保護の整理処理を定期実行する
- [x] 16.3 保持範囲外・DB復元後の範囲外カーソルに `resetRequired` を返し、Web と iOS が表示中データを全再取得して復旧する
- [x] 16.4 Vercel の Git 自動デプロイを全ブランチで停止する
- [x] 16.5 マイグレーション + 絵文字同期と Vercel 本番デプロイを別々の `workflow_dispatch` ワークフローへ分離する
- [x] 16.6 デプロイ側で未適用マイグレーションを読み取り検査し、DBを変更せずデプロイを拒否する
- [x] 16.7 README と設計・仕様を手動実行順序、必要 secrets、30日保持の復旧動作へ合わせる
- [x] 16.8 生成物を更新し、Go / frontend / Flutter の lint・test・build と OpenSpec strict validation を通す
