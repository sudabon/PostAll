## 1. 契約と生成物

- [x] 1.1 `api/openapi.yaml` に `POST /v1/emojis`（`operationId: createEmoji`, `tags: [emojis]`）を追加する。requestBody は `multipart/form-data`（`shortcode`: string、`file`: `type: string, format: binary`）、応答は `201` に既存の `Emoji` スキーマ、加えて `400` / `401` / `409` / `413` / `503` を既存の `Error` で宣言する。YAML が既存の並びと命名規約に沿っていることを目視で確認する
- [x] 1.2 `make generate` と `cd frontend && npm run generate` を実行し、`git diff --exit-code` が生成物の追従漏れを出さない状態にする（`backend/internal/api/openapi.gen.go` に `CreateEmoji` が生成され、`frontend/src/api/schema.d.ts` に新しい path が現れることを確認）

## 2. バックエンド: 検証規則の共有

- [x] 2.1 `backend/internal/emoji` のショートコード検証を、一括登録と要求経路の両方から使える形（公開関数か公開パターン）に切り出し、既存 `Sync` をその関数経由に置き換える。`go test ./internal/emoji/...` が通ることを確認する
- [x] 2.2 上限サイズの定数（512 KiB）と受理する形式（`image/png` / `image/gif`）を `internal/emoji` 側の単一の正として定義し、エラーメッセージが上限値と対応形式を含むことを単体テストで確認する

## 3. バックエンド: 登録処理

- [x] 3.1 `internal/emoji` に登録処理を追加する（形式をマジックバイトで判定 → `storage_key` を `emojis/<uuid>.<ext>` で生成 → Storage へ Put → `InsertEmoji`）。unique violation（`23505`）を `409` の `shortcode_conflict` にマップする。単体テストで PNG / GIF の成功、形式不一致、不正ショートコード、重複時に既存行と既存オブジェクトが変わらないことを確認する
- [x] 3.2 `internal/httpapi/emojis.go` に `CreateEmoji` ハンドラを追加する（`requireEmojis` → `authorFrom` → `http.MaxBytesReader` で本文を制限 → `ParseMultipartForm` → `internal/emoji` の登録処理 → `201` で `toAPIEmoji`）。`internal/emoji` のエラーを既存の `writeAppError` 経路に載せる
- [x] 3.3 `internal/httpapi/emojis_test.go` に HTTP 境界のテストを追加する: PNG 登録が `201` で `Emoji` を返す / GIF 登録が成功する / 非対応形式が `400` / 拡張子や `Content-Type` を偽ったファイルが `400` / 上限値ちょうどは成功し上限値+1 が `413` / 不正ショートコードが `400` / 未認証が `401` / 重複ショートコードが `409` かつ既存の実体が差し替わらない / `emojiBlobs` 未設定時が `503`
- [x] 3.4 `internal/emoji/sync_integration_test.go` に、要求経路で登録された行（`emojis/<uuid>.png` キー）が存在する状態で `Sync` を実行しても、`emoji/` に同じショートコードのファイルが無い限りカタログ行と実体が変わらないことのテストを追加する

## 4. フロントエンド: API クライアントとショートコード導出

- [x] 4.1 `frontend/src/api/client.ts` に multipart を送れる経路を足し（`json` と排他の `formData` を `fetchResponse` に通す。`Content-Type` はブラウザに任せて手で設定しない）、`createEmoji(file: File, shortcode: string)` を追加する。`client.test.ts` で `FormData` の中身と `Authorization` ヘッダが付くこと、`409` が `ApiError`（`code: 'shortcode_conflict'`）になることを確認する
- [x] 4.2 ファイル名からショートコードを導出する関数を `frontend/src/lib` に追加する（拡張子除去 → 小文字化 → 使えない文字を `-` に置換 → 連続 `-` を畳む → 先頭が英数字になるまで削る → 64 文字で切る → 末尾の `-`/`_` を削る、導出不能なら空文字）。vitest で正規化・切り詰め・先頭文字の除去・導出不能の各ケースを確認する
- [x] 4.3 クライアント側の事前検証（形式とサイズ）を関数として切り出し、上限値と対応形式をサーバと同じ値で持つ。vitest で対応形式外と上限超過が理由付きで弾かれることを確認する

## 5. フロントエンド: ピッカーの UI

- [x] 5.1 `EmojiPicker.tsx` の一覧ヘッダに「スタンプを追加」ボタンを置き、同じ `<dialog>` の中身を登録パネルへ切り替える（別ダイアログを重ねない）。パネルから一覧へ戻れることを確認する
- [x] 5.2 登録パネルにファイル選択（`<input type="file" accept="image/png,image/gif">` を視覚的に隠して label で開く）、プレビュー（`URL.createObjectURL` と離脱時の `revokeObjectURL`）、ショートコード入力欄を実装する。ファイル選択時に 4.2 の導出結果が初期値として入り、4.3 の事前検証で弾かれたファイルはアップロードを開始しないことを確認する
- [x] 5.3 登録の実行を実装する（進行中は確定ボタンを `disabled` にして進行を提示、成功時は `['emojis']` を invalidate して一覧へ戻る、失敗時は理由を表示して選択済みファイルとショートコードを保持）。カタログが空のときも追加操作が使えることを確認する
- [x] 5.4 `frontend/src/components/reactions/Reactions.test.tsx` に登録パネルのコンポーネントテストを追加する: 追加ボタンでパネルが開く / ショートコードの初期値が入る / 事前検証で弾かれると要求が飛ばない / 進行中は確定操作を受け付けない / 失敗時に入力が保持される / 成功後に一覧が再取得される
- [x] 5.5 `EmojiImage` のオブジェクト URL を blob ごとに 1 つ持つ形に直し、StrictMode の effect 二重実行で revoke 済み URL を参照する既存バグ（開発ビルドで全カスタム絵文字が読めずショートコードのテキストにフォールバックする）を解消する。TP-012 が通ることで確認する

## 6. E2E fixture

- [x] 6.1 `frontend/e2e/mock.ts` に `POST /v1/emojis` のモックを追加し、成功時は受け取った `shortcode` で新しい `Emoji` を返してカタログに加える。`installApiMock` のオプションで応答を切り替えられるようにする（`mock:emoji-upload-conflict` = `409`、`mock:emoji-upload-error` = `500`、`mock:emoji-upload-slow` = テスト側から解放できる遅延）。既定の状態を `mock:signed-in-with-emojis` として扱えることを確認する
- [x] 6.2 `installApiMock` にカタログ 0 件の初期状態（`mock:signed-in-empty-catalog`）を追加し、既存の E2E が回帰しないことを確認する
- [x] 6.3 テストで使う画像 fixture を用意する（`file:small-png`、`file:animated-gif`、`file:unsupported-format`、`file:oversized-png`、`file:unusable-name-png`）。バイト列は `setInputFiles` へ渡せる形でテストコード側から生成するか、リポジトリに置くかを決めて統一する
- [x] 6.4 `frontend/tests/e2e/fixtures/README.md` の表に 6.1〜6.3 の fixture 名・作られる状態・使用する TP-ID・方式（fixture 直接方式）を登録する。テスト本体は `frontend/e2e/` に置く（`playwright.config.ts` の `testDir` と `scripts/check-test-plan.sh` がそこを見る）ため、README とテストの置き場所が分かれている点を表に注記する

## 7. E2E テスト実装（test-plan.md の TP と 1:1）

- [x] 7.1 TP-001: ピッカーの追加操作から PNG を登録し、再読み込みなしで一覧に現れることを検証する。タグ `['@add-stamp-upload-in-picker', '@TP-001']`
- [x] 7.2 TP-002: 登録直後のスタンプを一覧から選んでリアクションが付くことを検証する。タグ `['@add-stamp-upload-in-picker', '@TP-002']`
- [x] 7.3 TP-003: ファイル選択直後のショートコード欄に拡張子を除いたファイル名が入ることを検証する。タグ `['@add-stamp-upload-in-picker', '@TP-003']`
- [x] 7.4 TP-004: ショートコードを書き換えて登録すると書き換えた名前で一覧に現れることを検証する。タグ `['@add-stamp-upload-in-picker', '@TP-004']`
- [x] 7.5 TP-005: 導出できないファイル名では欄が空で提示され、妥当な値を入れるまで登録を確定できないことを検証する。タグ `['@add-stamp-upload-in-picker', '@TP-005']`
- [x] 7.6 TP-006: 対応形式外のファイルを選ぶと要求が送られず理由が表示されることを検証する。タグ `['@add-stamp-upload-in-picker', '@TP-006']`
- [x] 7.7 TP-007: 上限サイズ超過のファイルを選ぶと要求が送られず上限値付きの理由が表示されることを検証する。タグ `['@add-stamp-upload-in-picker', '@TP-007']`
- [x] 7.8 TP-008: 重複ショートコードで `409` を受けたとき、重複が提示され既存の一覧表示が変わらず入力が保持されることを検証する。タグ `['@add-stamp-upload-in-picker', '@TP-008']`
- [x] 7.9 TP-009: サーバエラーで失敗したとき、理由が提示され入力を保持したまま再試行できることを検証する。タグ `['@add-stamp-upload-in-picker', '@TP-009']`
- [x] 7.10 TP-010: 応答前に確定操作を繰り返しても要求が 1 件で、一覧に 1 件だけ現れることを検証する。タグ `['@add-stamp-upload-in-picker', '@TP-010']`
- [x] 7.11 TP-011: カタログが空でも未登録の表示とともに追加操作が使えることを検証する。タグ `['@add-stamp-upload-in-picker', '@TP-011']`
- [x] 7.12 TP-012: GIF を登録して一覧とリアクションで画像として表示されることを検証する。タグ `['@add-stamp-upload-in-picker', '@TP-012']`

## 8. ドキュメント

- [x] 8.1 `API_REFERENCE.md` に `POST /v1/emojis` を追加する（要求の形式、上限サイズ、対応形式、`409` の条件）。既存の記述形式に揃っていることを確認する
- [x] 8.2 `ARCHITECTURE.md` の絵文字カタログに関する記述（デプロイ時の一括登録のみという前提）を、要求経路からの 1 件登録が加わった構成に更新する
- [x] 8.3 `DATABASE_SCHEMA.md` の `emojis` の節を、カタログの正がリポジトリの `emoji/` だけではなくなった点と `storage_key` の 2 つの形（ファイル名 / `emojis/<uuid>.<ext>`）が混在する点を含めて更新する

## 9. 検証

- [x] 9.1 `make lint` と `make typecheck` が通ることを確認する
- [x] 9.2 backend のテストを `DOCKER_HOST=unix:///Users/y-suda/.rd/docker.sock TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock go test ./...` で実行し、integration テストを含めて全て通ることを確認する
- [x] 9.3 `cd frontend && npm test` が通ることを確認する（本 change のテストは全て通過。`src/platform/browser.test.ts` の 3 件と `SearchDialog > loads another cursor page` の 1 件は本 change の変更を stash しても同じように落ちる既存の失敗で、ここでは直さない）
- [x] 9.4 `cd frontend && npx playwright test --grep @add-stamp-upload-in-picker` で TP-001〜TP-012 が全て通ることを確認し、続けて `npm run test:e2e` で既存の E2E に回帰が無いことを確認する
- [x] 9.5 `bash scripts/check-test-plan.sh` が検証する 2 条件（`test-plan.md` の存在、`frontend/e2e/` に `@add-stamp-upload-in-picker` タグ付きテストがあること）を満たすことを確認する。スクリプト自体は、change の差分が未コミットのとき `ids=$(... | grep -v ...)` の grep が空入力で 1 を返し `set -euo pipefail` で落ちるため exit 1 になる（本 change の変更を退避しても同じ）。コミット後は差分が拾えるので通る
- [x] 9.6 `openspec validate add-stamp-upload-in-picker --strict` が通ることを確認する
