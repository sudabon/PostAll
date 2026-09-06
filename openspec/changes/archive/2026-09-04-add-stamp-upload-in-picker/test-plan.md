# Test Plan

このアーティファクトは specs/ 配下の各 Requirement のシナリオ(受け入れ基準)を
E2E で検証可能な観点に翻訳したものである。受け入れ基準の原本は specs のシナリオで
あり、本ファイルで新しい仕様を定義してはならない。

change-id: `add-stamp-upload-in-picker`

## 前提となる E2E 環境

本プロジェクトの E2E は `frontend/e2e/` の Playwright テストで、`installApiMock`（`frontend/e2e/mock.ts`）が
`/v1/*` を route intercept してインメモリのモデルを返す構成になっている。したがって本計画の fixture は
すべて「fixture 直接方式」（`installApiMock` のオプションでモックの初期状態と応答を作る）である。
シード API は存在しないため使わない。

`playwright.config.ts` の `testMatch` は `app.spec.ts` / `pwa.spec.ts` に限定されている。新しい spec
ファイルを足す場合は `testMatch` の更新が必要になる（apply 側の判断）。

## E2E観点一覧

| TP-ID | 対応シナリオ | 前提(fixture) | 操作の意図 | 期待結果 | リスク |
|-------|-------------|---------------|-----------|---------|--------|
| TP-001 | 絵文字の一覧と選択 / ピッカーから登録を開始する<br>絵文字の一覧と選択 / 登録直後に一覧へ反映する<br>スタンプ画像のアップロード登録 / PNG を登録する | `mock:signed-in-with-emojis` + `file:small-png` | ピッカーの追加操作から PNG を選び、提示されたショートコードのまま登録を確定する | 登録が成功し、再読み込みの操作なしに同じピッカーの一覧に当該ショートコードのスタンプが現れる | 高 |
| TP-002 | 絵文字の一覧と選択 / 登録したスタンプをそのままリアクションに使う | `mock:signed-in-with-emojis` + `file:small-png` | 登録直後のスタンプを一覧から選択する | 当該ポストに新しいスタンプのリアクションが 1 件付き、自分の付与として区別して表示される | 高 |
| TP-003 | 登録するスタンプのショートコードの決定 / ファイル名からショートコードを導出する | `mock:signed-in-with-emojis` + `file:small-png` | 拡張子付きのファイルを選択した直後のショートコード欄を見る | ファイル名の拡張子を除いた文字列が初期値として入っている | 中 |
| TP-004 | 登録するスタンプのショートコードの決定 / ショートコードを修正して登録する | `mock:signed-in-with-emojis` + `file:small-png` | 提示されたショートコードを別の値へ書き換えて登録を確定する | 書き換えた後のショートコードで登録され、一覧にもその名前で現れる | 中 |
| TP-005 | 登録するスタンプのショートコードの決定 / ファイル名からショートコードを導出できない | `mock:signed-in-with-emojis` + `file:unusable-name-png` | ショートコードに整えられないファイル名の画像を選ぶ | ショートコード欄は空で提示され、入力を促す表示が出て、妥当な値を入れるまで登録を確定できない | 中 |
| TP-006 | スタンプ画像のアップロード登録 / クライアント側でも制約を先に検証する<br>スタンプ画像のアップロード登録 / 対応していない形式を拒否する | `mock:signed-in-with-emojis` + `file:unsupported-format` | PNG でも GIF でもないファイルを選ぶ | アップロードの要求は一切送られず、対応している形式を示す理由がその場に表示される | 中 |
| TP-007 | スタンプ画像のアップロード登録 / クライアント側でも制約を先に検証する<br>スタンプ画像のアップロード登録 / 上限サイズを超える画像 | `mock:signed-in-with-emojis` + `file:oversized-png` | 上限サイズを超える画像を選ぶ | アップロードの要求は一切送られず、上限値を含む理由がその場に表示される | 中 |
| TP-008 | スタンプ画像のアップロード登録 / ショートコードが既存と重複する | `mock:emoji-upload-conflict` + `file:small-png` | 既存のショートコードと同じ値で登録を確定する | 重複している旨が提示され、一覧の既存スタンプの表示は変わらず、選択した画像とショートコードは保持されたまま修正できる | 高 |
| TP-009 | スタンプ登録の進行と失敗時の扱い / 登録が失敗する | `mock:emoji-upload-error` + `file:small-png` | サーバ側のエラーで登録が失敗する状況で登録を確定する | 失敗した旨と理由が提示され、選択済みの画像とショートコードが保持され、同じ内容で再試行できる | 高 |
| TP-010 | スタンプ登録の進行と失敗時の扱い / 登録中の表示<br>スタンプ登録の進行と失敗時の扱い / 登録操作の二重実行 | `mock:emoji-upload-slow` + `file:small-png` | 応答が返る前に登録の確定操作を繰り返す | 進行中であることが提示され、確定操作は受け付けられず、登録要求は 1 件しか送られない。応答後に一覧へ 1 件だけ現れる | 高 |
| TP-011 | 絵文字の一覧と選択 / 絵文字が 1 件も登録されていない | `mock:signed-in-empty-catalog` | カタログが空の状態でピッカーを開く | 未登録である旨が表示され、エラー表示にはならず、スタンプを追加する操作は利用できる | 中 |
| TP-012 | スタンプ画像のアップロード登録 / アニメーション GIF を登録する | `mock:signed-in-with-emojis` + `file:animated-gif` | GIF を選んで登録し、一覧とリアクションでの表示を見る | 登録が成功し、ショートコードのテキストへのフォールバックではなく画像として表示される | 中 |

## E2E対象外(委譲先と理由)

| シナリオ | 委譲先 | 理由 |
|---------|--------|------|
| スタンプ画像のアップロード登録 / 対応していない形式を拒否する（サーバ側） | backend integration test (`internal/httpapi`) | クライアントの事前検証を通さずに要求を投げる状況は UI から作れない。HTTP 境界を直接叩いて形式ごとの応答を網羅する。E2E ではクライアント側の事前検証のみを TP-006 で見る |
| スタンプ画像のアップロード登録 / 申告と実体の形式が食い違う | backend integration test (`internal/httpapi`) | 拡張子や `Content-Type` を偽った本文の組み合わせは HTTP 要求を手で組む必要がある。ブラウザ経由では再現できない |
| スタンプ画像のアップロード登録 / 上限サイズを超える画像（サーバ側） | backend integration test (`internal/httpapi`) | 上限のちょうど境界（上限値・上限値+1）の検証は HTTP 境界で行う方が確実。E2E は TP-007 でクライアント側の事前検証のみ |
| スタンプ画像のアップロード登録 / ショートコードとして不正な値（サーバ側） | backend unit/integration test (`internal/emoji`, `internal/httpapi`) | 使える文字・長さ・先頭文字の網羅は入力パターンの数が多く、単体テストの方が安い。E2E は TP-005 で UI 側の入力ガードのみ |
| スタンプ画像のアップロード登録 / 認可されていない登録要求 | backend integration test (`internal/httpapi`) | 未認証の要求は既存の認可ミドルウェアの責務で、サインイン済みを前提とする E2E からは再現できない |
| スタンプ画像のアップロード登録 / 実体の配置後にカタログへの記録が失敗する | backend integration test (`internal/httpapi`) | Storage への配置が成功した後に insert だけを失敗させる状態は UI から作れない。重複ショートコードでの登録要求で同じ順序を通す |
| カスタム絵文字カタログ / png を登録する | backend integration test (`internal/emoji`) | `emoji/` 走査はデプロイ工程のコマンドで、UI 経路を通らない。既存の `sync_integration_test.go` の範囲 |
| カスタム絵文字カタログ / 内容が変わった png を再登録する | backend integration test (`internal/emoji`) | 同上。既存テストで担保済みで、本 change で挙動を変えない |
| カスタム絵文字カタログ / 内容が同じ png を再走査する | backend integration test (`internal/emoji`) | 同上 |
| カスタム絵文字カタログ / png 以外のファイルを無視する | backend integration test (`internal/emoji`) | 同上。要求経路が GIF を受けるようになっても、一括登録の gif 無視は変えない点をここで固定する |
| カスタム絵文字カタログ / ショートコードとして不正なファイル名 | backend integration test (`internal/emoji`) | 同上 |
| カスタム絵文字カタログ / 登録処理は API サーバの起動に依存しない | backend integration test (`cmd/postall-server`) | サーバ起動時の副作用の不在を見る観点で、UI からは観測できない。既存テストの範囲 |
| カスタム絵文字カタログ / 要求経路で登録されたスタンプを一括登録が壊さない | backend integration test (`internal/emoji`) | 要求経路で作った行に対して一括登録を走らせる組み合わせで、デプロイ工程とデータベースの状態を直接見る必要がある |
| 絵文字の一覧と選択 / 絵文字ピッカーを開く | 既存 E2E（`emoji reactions filter, roll back, toggle, and work in replies`） | 既にカバー済みで、本 change で挙動を変えない。回帰は既存テストが検出する |
| 絵文字の一覧と選択 / 絵文字を絞り込む | 既存 E2E（同上） | 同上 |
| 絵文字画像の配信 / 絵文字画像を取得する | backend integration test (`internal/httpapi`) | 応答の本文と形式を示すヘッダの検証は HTTP 境界で行う。GIF が画像として表示されることは TP-012 で見る |
| 絵文字画像の配信 / 認可されていない取得要求 | backend integration test (`internal/httpapi`) | 未認証の要求は E2E から再現できない。既存テストの範囲 |
| 絵文字画像の配信 / 登録されていないショートコード | backend integration test (`internal/httpapi`) | 既存テストで担保済み。応答コードの検証は HTTP 境界の責務 |
| 絵文字画像の配信 / 内容が変わっていない画像を再取得する | backend integration test (`internal/httpapi`) | ETag と 304 の検証は HTTP 境界の責務。ブラウザのキャッシュ挙動に依存させたくない |
| 絵文字画像の配信 / 絵文字の実体が失われている | backend integration test (`internal/httpapi`) | 既存テストで担保済み。カタログと Storage の食い違いを作る操作が UI に無い |
| 登録するスタンプのショートコードの決定 / 導出規則の細部（正規化・切り詰め・先頭文字の除去） | frontend unit test (vitest) | 入力パターンの網羅は単体テストの方が安い。E2E は代表 1 例（TP-003）と導出不能の例（TP-005）に絞る |

## タグ対応

- すべての実装テストに `@add-stamp-upload-in-picker` と `@TP-NNN` を付与すること
- TP-ID は spec のシナリオと実装テストを結ぶ唯一の鍵。TP-ID を消したり付け替えたりする場合は本ファイルを先に更新する
- fixture 名（`mock:*`）とファイル fixture 名（`file:*`）は、apply 時に `frontend/tests/e2e/fixtures/README.md` の表へ登録すること
