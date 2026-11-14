# E2E シード fixture 一覧

test-plan.md の「前提(fixture)」列に書いた fixture 名は、必ずこの表に登録すること。
表を見れば「そのテストがどんな状態から始まるか」が読み手に分かる状態を維持する。

テスト本体は `frontend/e2e/` に置く（`playwright.config.ts` の `testDir` と
`scripts/check-test-plan.sh` がそこを見る）。この表はその隣の `fixtures/` に置く。

## fixture 名 → 作られる状態

| fixture 名 | 作られる状態 | 使用する TP-ID | 方式 |
|-----------|-------------|---------------|------|
| `mock:signed-in-with-emojis` | サインイン済み + チャネル `inbox` とポスト 1 件 + 既存スタンプ 3 件（shipit / party / fail）。`installApiMock(page)` の既定 | TP-001〜TP-007, TP-009, TP-012 / harden: TP-004, TP-005 | fixture 直接方式 |
| `mock:signed-in-empty-catalog` | 上記からスタンプカタログだけを空にした状態。`installApiMock(page, { emptyEmojiCatalog: true })` | TP-011 | fixture 直接方式 |
| `mock:emoji-upload-conflict` | スタンプ登録要求に `409 shortcode_conflict` を返す。`installApiMock(page, { emojiUpload: 'conflict' })` | TP-008 | fixture 直接方式 |
| `mock:emoji-upload-error` | スタンプ登録要求に `500` を返す。`installApiMock(page, { emojiUpload: 'error' })` | TP-009 | fixture 直接方式 |
| `mock:emoji-upload-slow` | 登録要求の応答を保留し、`releaseEmojiUpload()` で解放できる。`installApiMock(page, { emojiUpload: 'slow' })` | TP-010 | fixture 直接方式 |
| `file:small-png` | 上限に十分収まる 1x1 PNG（`fixtures/stamps.ts` の `smallPng`） | TP-001〜TP-004, TP-008〜TP-011 | fixture 直接方式 |
| `file:animated-gif` | アニメーションを含む GIF（`animatedGif`） | TP-012 | fixture 直接方式 |
| `file:unsupported-format` | PNG でも GIF でもないファイル（`unsupportedFormat`） | TP-006 | fixture 直接方式 |
| `file:oversized-png` | 上限 512 KiB を 1 バイト超える PNG（`oversizedPng`） | TP-007 | fixture 直接方式 |
| `file:unusable-name-png` | ショートコードに整えられないファイル名の PNG（`unusableNamePng`） | TP-005 | fixture 直接方式 |
| `mock:account-not-allowed` | サインイン済み（拒否されるトークン `REJECTED_ACCESS_TOKEN` を端末の永続ストレージにも置く）の状態から、全 `/v1/*` に `403 {"code":"account_not_allowed"}` を返す。受けた要求は `v1Requests()` で数えられる。`installApiMock(page, { accountNotAllowed: true })` | harden: TP-001, TP-002 | fixture 直接方式 |
| `mock:rich-content-post` | チャネル `rich` に、コードブロック（ts）・Mermaid 図・画像添付を 1 つずつ含むポスト 1 件（`RICH_CONTENT_BODY` / `RICH_CONTENT_IMAGE`）。添付のダウンロード URL は同一オリジンのモック画像 `/e2e-assets/rich-content.png` を指す。`installApiMock(page, { richContentPost: true })` | harden: TP-006 | fixture 直接方式 |
| `build:pwa-preview` | `VITE_E2E` 無し・`VITE_SUPABASE_URL=https://auth.example.test` で `vite build` した `dist` を `vite preview`（4174）で配る。CSP 付きのサインイン前のアプリシェル。`playwright.config.ts` の `pwa` project | harden: TP-003 | 配信設定（シード無し） |
| `build:csp-e2e` | `VITE_E2E=true` で `dist-csp-e2e` へ `vite build` し、`vite preview`（4175）で配る。CSP 付きの本番ビルドで、サインイン済みのモックを描画できる。`playwright.config.ts` の `csp` project | harden: TP-004〜TP-006 | 配信設定（シード無し） |
| `electron:built-dist` | `cd frontend && npm run build` の `frontend/dist`（CSP 付き）を一時ディレクトリへ写し、観測用の同一オリジンスクリプト `/__e2e__/csp-probe.js` を 1 行足して Electron に読み込ませる（`POSTALL_FRONTEND_DIR`）。`electron/test/csp.e2e.mjs` | harden: TP-007 | 配信設定（シード無し） |
| `mock:encryption-unconfigured` | サインイン済み + 非暗号化チャネル `inbox`（ポスト 1 件）。暗号化の鍵束は未設定（`GET /v1/encryption/keyring` が 404）。`installEncryptionMock(page, 'unconfigured')`（`fixtures/encryption.ts`） | encryption: TP-003, TP-009, TP-010 | fixture 直接方式 |
| `mock:encryption-locked` | 鍵束（テスト用のパスフレーズ `TEST_PASSPHRASE` と復旧キー `TEST_RECOVERY_KEY` で包む）+ 暗号化チャネル `secret`（Markdown・コード・Mermaid を含むポストと、暗号化した返信を 1 件持つポスト。別の端末が投稿した暗号文）+ `inbox`。端末に記憶した鍵は無い。`installEncryptionMock(page, 'locked')` | encryption: TP-008, TP-012〜TP-017, TP-019, TP-021〜TP-023, TP-032 | fixture 直接方式 |
| `mock:encryption-unlocked` | `mock:encryption-locked` に加えて、「この端末で記憶する」で解錠した後と同じ鍵（取り出せない `CryptoKey`）を IndexedDB の `postall-keys` に事前に置く。ページは同じオリジンの空のページ（`/__e2e__/blank`）にあり、続けて `page.goto('/')` で開く。`installEncryptionMock(page, 'unlocked')`。TP-018 / TP-020 は記憶しない解錠が要るので、鍵を置かずに開き、記憶しないで解錠してから始める | encryption: TP-001, TP-002, TP-004〜TP-007, TP-018, TP-020, TP-025〜TP-031 | fixture 直接方式 |
| `mock:encryption-setup-conflict` | 別の端末が `TEST_PASSPHRASE` の鍵束を登録済み。初期設定の確定（`POST /v1/encryption/keyring`）が `409 encryption_already_configured` になるまでは、`GET` が 404 を返して未設定に見える。`installEncryptionMock(page, 'setup-conflict')` | encryption: TP-011 | fixture 直接方式 |
| `mock:encryption-tampered-post` | 鍵束 + 暗号化チャネル `secret` に、正しく読めるポスト・1 バイト改ざんした暗号文（`tamper`）・別の鍵 ID と鍵の暗号文（`foreignCiphertext`）を 1 件ずつ。`installEncryptionMock(page, 'tampered-post')` | encryption: TP-024 | fixture 直接方式 |
| `clock:idle` | Playwright の時計（`page.clock.install()`）に差し替え、`idle(page, '15:00')` で操作の無い時間だけを進める。ページを開く前に `installIdleClock(page)` を呼ぶ（`fixtures/clock.ts`） | encryption: TP-018, TP-020 | 時計の制御（シード無し） |
| `browser:webkit-iphone` | `playwright.config.ts` の `webkit-iphone` project（`devices['iPhone 15']`、WebKit）。`@TP-032` のテストだけを走らせる。`app` project からは `@TP-032` を外す | encryption: TP-032 | 実行環境（シード無し） |
| `electron:encryption-key-store` | 一時的な `--user-data-dir` で Electron を起動し、観測用のページ（`/__e2e__/key-store-probe.js` を足した本番ビルドの `dist`）から、レンダラの `window.postallPlatform` 経由で electron adapter と同じ `secret:*` の操作をする。同じ `user-data-dir` で再起動して読み戻す。`electron/test/encryption-key-store.e2e.mjs` | encryption: TP-033 | 配信設定（シード無し） |

TP-ID の「harden:」は change `harden-sensitive-data-protection`、「encryption:」は change
`add-client-side-post-encryption` の test-plan の ID で、接頭辞の無いものは
`add-stamp-upload-in-picker` の ID である。

`build:*` と `electron:*` はデータではなく、CSP を観測するための配信の仕方である（CSP は本番ビルドにだけ付く）。

`mock:*` は `installApiMock` のオプションで作るモックの初期状態、`file:*` は
`setInputFiles` に渡す画像ペイロードで、どちらも `frontend/e2e/fixtures/` にある。
`file:*` はバイナリをリポジトリに置かず、コードから組み立てている（サイズや形式の
意図がテストから読めるようにするため）。

## 方式について

- **シードAPI方式**: テスト用エンドポイント(例 `POST /__test__/seed`)にシード名を渡し、
  アプリ側のトランザクションで状態を作る。本番コードと同じ経路を通るので不整合が起きにくく、
  DB スキーマ変更にも追従しやすい。原則こちらを使う。
- **fixture 直接方式**: Playwright の fixture から DB やストレージへ直接書き込む。
  シードAPIを用意できない外部依存や、API では作れない異常状態(壊れたレコード等)に限って使う。

本プロジェクトにはシード API が無く、E2E は `frontend/e2e/mock.ts` の
`installApiMock` が `/v1/*` を route intercept してインメモリのモデルを返す構成である。
そのため上記はすべて fixture 直接方式になる。

どちらの方式でも、fixture は各テストの前に**べき等に**状態を作り直し、テスト間で状態を
共有しないこと(順序依存の禁止は `.claude/skills/e2e-conventions/SKILL.md` を参照)。
