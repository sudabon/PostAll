# E2E シード fixture 一覧

test-plan.md の「前提(fixture)」列に書いた fixture 名は、必ずこの表に登録すること。
表を見れば「そのテストがどんな状態から始まるか」が読み手に分かる状態を維持する。

テスト本体は `frontend/e2e/` に置く（`playwright.config.ts` の `testDir` と
`scripts/check-test-plan.sh` がそこを見る）。この表はその隣の `fixtures/` に置く。

## fixture 名 → 作られる状態

| fixture 名 | 作られる状態 | 使用する TP-ID | 方式 |
|-----------|-------------|---------------|------|
| `mock:signed-in-with-emojis` | サインイン済み + チャネル `inbox` とポスト 1 件 + 既存スタンプ 3 件（shipit / party / fail）。`installApiMock(page)` の既定 | TP-001〜TP-007, TP-009, TP-012 | fixture 直接方式 |
| `mock:signed-in-empty-catalog` | 上記からスタンプカタログだけを空にした状態。`installApiMock(page, { emptyEmojiCatalog: true })` | TP-011 | fixture 直接方式 |
| `mock:emoji-upload-conflict` | スタンプ登録要求に `409 shortcode_conflict` を返す。`installApiMock(page, { emojiUpload: 'conflict' })` | TP-008 | fixture 直接方式 |
| `mock:emoji-upload-error` | スタンプ登録要求に `500` を返す。`installApiMock(page, { emojiUpload: 'error' })` | TP-009 | fixture 直接方式 |
| `mock:emoji-upload-slow` | 登録要求の応答を保留し、`releaseEmojiUpload()` で解放できる。`installApiMock(page, { emojiUpload: 'slow' })` | TP-010 | fixture 直接方式 |
| `file:small-png` | 上限に十分収まる 1x1 PNG（`fixtures/stamps.ts` の `smallPng`） | TP-001〜TP-004, TP-008〜TP-011 | fixture 直接方式 |
| `file:animated-gif` | アニメーションを含む GIF（`animatedGif`） | TP-012 | fixture 直接方式 |
| `file:unsupported-format` | PNG でも GIF でもないファイル（`unsupportedFormat`） | TP-006 | fixture 直接方式 |
| `file:oversized-png` | 上限 512 KiB を 1 バイト超える PNG（`oversizedPng`） | TP-007 | fixture 直接方式 |
| `file:unusable-name-png` | ショートコードに整えられないファイル名の PNG（`unusableNamePng`） | TP-005 | fixture 直接方式 |

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
