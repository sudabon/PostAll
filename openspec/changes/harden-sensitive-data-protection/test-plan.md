# Test Plan

このアーティファクトは specs/ 配下の各 Requirement のシナリオ(受け入れ基準)を
E2E で検証可能な観点に翻訳したものである。受け入れ基準の原本は specs のシナリオで
あり、本ファイルで新しい仕様を定義してはならない。

change-id: `harden-sensitive-data-protection`

## 前提となる E2E 環境

- `frontend/e2e/` の Playwright テストは、`installApiMock`（`frontend/e2e/mock.ts`）で `/v1/*` を route intercept する。fixture はすべて「fixture 直接方式」で、シード API は無い。
- CSP は本番ビルドにだけ付く（開発サーバには付けない）。そのため CSP を観測する観点（TP-003〜TP-006）は、`vite build` の成果物を `vite preview` で配信する環境で実行する。
  - サインイン前の文書だけを見る観点は、既存の `pwa` プロジェクト（`VITE_E2E` 無しのビルド）で足りる。
  - サインイン済みの描画が要る観点は、`VITE_E2E=true` でビルドしたうえで preview する配信が要る。webServer と project の追加は apply で判断する。
- Electron の観点（TP-007）は、`electron/test/*.e2e.mjs` と同じ方式の Node スクリプトで、実際の Electron を起動して検証する。Playwright の tag は使えないので、テスト名とファイル先頭のコメントに `@harden-sensitive-data-protection` と `@TP-007` を書く。
- backend の許可リスト・本文消去は、UI のモックからは観測できない。どちらも `internal/httpapi` の integration test（testcontainers の PostgreSQL）へ委譲する。

## E2E観点一覧

| TP-ID | 対応シナリオ | 前提(fixture) | 操作の意図 | 期待結果 | リスク |
|-------|-------------|---------------|-----------|---------|--------|
| TP-001 | 利用を許可するアカウントの限定 / クライアントが拒否を受け取る<br>利用を許可するアカウントの限定 / 許可されていないアカウントで要求する（クライアントから見た結果） | `mock:account-not-allowed` | サインイン済みの状態でアプリを開き、最初のデータ取得が「許可されていない」で拒否される状況を作る | サインイン画面へ戻り、このアカウントでは利用が許可されていない旨が表示される。チャネル・ポストは一切表示されない。保持していたトークンが端末から消えている | 高 |
| TP-002 | 利用を許可するアカウントの限定 / クライアントが拒否を受け取る（同じトークンで繰り返さない・複数の拒否が同時に届く） | `mock:account-not-allowed` | 並行して走る複数の取得がすべて拒否される状況で、サインイン画面に戻った後もしばらく待つ | 案内は 1 つだけ表示される（重複しない）。サインイン画面に戻った後、拒否されたトークンでの `/v1/*` 要求は新たに送られない | 中 |
| TP-003 | スクリプト実行元の制限 / アプリシェルにポリシーが付いている | `build:pwa-preview` | 本番ビルドのアプリシェルを取得し、付いているポリシーを読む | スクリプトの実行元が自オリジンに限られている。インラインスクリプトと文字列からのコード評価が許されていない。プラグイン要素と `<base>` の差し替えも禁止されている | 高 |
| TP-004 | スクリプト実行元の制限 / 無害化をすり抜けたインラインスクリプト | `build:csp-e2e` + `mock:signed-in-with-emojis` | サインイン済みの画面で、文書にインラインスクリプト要素と、イベントハンドラ属性を持つ要素を挿入する | どちらも実行されない（実行されたら立つはずの印が立たない）。スクリプト実行元のポリシー違反として記録される | 高 |
| TP-005 | スクリプト実行元の制限 / 許可していない接続先への通信 | `build:csp-e2e` + `mock:signed-in-with-emojis` | アプリ内から、自オリジンでも許可した提供元でもない接続先へ通信を試みる | 通信は失敗する。接続先のポリシー違反として記録される | 中 |
| TP-006 | スクリプト実行元の制限 / 既存の描画が動く | `build:csp-e2e` + `mock:rich-content-post` | コードブロック・Mermaid 図・画像添付を含むポストを表示する | コードブロックはハイライトされ、Mermaid は図として描画され、画像が表示される。表示の間、ポリシー違反は 1 件も記録されない | 高 |
| TP-007 | スクリプト実行元の制限 / デスクトップでも同じポリシーを適用する | `electron:built-dist` | 本番ビルドの成果物を Electron で読み込み、文書にインラインスクリプトを挿入する | ブラウザと同じポリシーが付いている。挿入したインラインスクリプトは実行されない。アプリシェルは通常どおり表示される | 中 |

## E2E対象外(委譲先と理由)

| シナリオ | 委譲先 | 理由 |
|---------|--------|------|
| 利用を許可するアカウントの限定 / 許可されたアカウントで要求する | backend integration test (`internal/httpapi`) + 既存 E2E | サーバ側の許可判定は、UI のモックを通すと観測できない。HTTP 境界で、許可した `sub` の JWT が 200 になることを見る。クライアントの通常動作は、既存の全 E2E（サインイン済みのモック）が回帰を検出する |
| 利用を許可するアカウントの限定 / 許可されていないアカウントで要求する（サーバ側） | backend integration test (`internal/httpapi`) | 正当な署名の JWT を、許可リスト外の `sub` で組み立てる必要があり、HTTP 境界で直接叩く。401 と異なる状態であることと、識別コード `account_not_allowed` もここで固定する |
| 利用を許可するアカウントの限定 / 許可されていないアカウントのユーザーを作らない | backend integration test (`internal/httpapi`) | `users` 行が作られないことは、DB を直接見ないと観測できない |
| 利用を許可するアカウントの限定 / 許可リストが未設定 | backend unit test (`internal/auth`) + integration test (`internal/httpapi`) | 空・未設定・空白だけの値・大文字小文字の違いの網羅は、入力パターンの数が多く、単体テストの方が安い。空集合のときに全拒否になることは HTTP 境界で 1 本確かめる |
| 利用を許可するアカウントの限定 / 認証サービスの新規登録が誤って有効になる | backend integration test (`internal/httpapi`) | 「招待していないアカウント」は、API から見れば「許可リスト外の正当な JWT」と同じである。Supabase の設定を本番で変える試験は行わない |
| 利用を許可するアカウントの限定 / 認可を要さない経路 | backend integration test (`internal/httpapi`) | `/health`・`/ready`・`/internal/*` は UI から叩かない経路である。許可リストが空の状態でも、既存の規則どおりに応答することを HTTP 境界で見る |
| 利用を許可するアカウントの限定 / クライアントが拒否を受け取る（拒否と他の 403 の区別） | frontend unit test (vitest, `api/client.test.ts`) | `account_not_allowed` 以外の 403（添付の `forbidden`）を受けた場合はサインアウトしないことを確かめる。添付の 403 を返す状況は UI の操作からは作れないので、`ApiClient` の単体で固定する |
| ユーザーの登録 / 初回サインイン | backend integration test (`store`, `internal/httpapi`) | 既存の `users_integration_test.go` の範囲に、許可リスト内である前提を加える。行の作成は DB を見ないと観測できない |
| ユーザーの登録 / 2 回目以降のサインイン | backend integration test (`store`) | 既存テストで担保済みで、本 change では挙動を変えない |
| ユーザーの登録 / 登録済みのアカウントが許可リストから外れる | backend integration test (`internal/httpapi`) | `users` 行を先に作った状態で許可リストから外す、という状態は DB と設定の操作でしか作れない |
| トークンの安全な保管 / デスクトップでの保管 | Electron unit test (`electron/test/secret-store.test.mjs`) | `safeStorage` が使える場合に暗号文だけが書かれることを、偽物の `safeStorage` と `fs` を注入して確かめる。実際の Keychain を使う試験は CI で安定しない |
| トークンの安全な保管 / デスクトップで安全な保管領域が使えない | Electron unit test (`electron/test/secret-store.test.mjs`) | 実機の macOS では `safeStorage` が使えない状態を作れない。偽物を注入して、ファイルに書かれないこと・メモリでは保持されることを見る |
| トークンの安全な保管 / 過去に暗号化せずに保存したトークンが残っている | Electron unit test (`electron/test/secret-store.test.mjs`) | 平文の保存ファイルを置いた状態は、偽の `fs` で作るのが最も確実である。読み込まれないことと、ファイルが削除されることを見る |
| トークンの安全な保管 / ブラウザでの保管と復元 | 既存 E2E（`pwa.spec.ts` のサインイン関連） | 本 change で挙動を変えない。回帰は既存テストが検出する |
| トークンの安全な保管 / ブラウザを閉じたあと再訪する | 既存 E2E / frontend unit test（`auth/session.test.ts`） | 同上 |
| トークンの安全な保管 / ブラウザでサインアウトする | 既存 E2E（`sign-in workspace post thread dnd and restore`） | 同上。拒否を受けたときにトークンが消えることは TP-001 で見る |
| トークンの安全な保管 / iOS での保管 | 対象外 | iOS ネイティブアプリは存在せず（iPhone は PWA で提供）、本 change で触れない |
| ポストの論理削除 / ポストを削除する | 既存 E2E（`@optimistic-post-create-and-delete`「削除の承認直後に行が消える」） | 本 change では UI の挙動を変えない |
| ポストの論理削除 / 削除と同時に本文を消去する | backend integration test (`internal/httpapi`, `posts_integration_test.go`) | DB の `body` が空になり、`deleted_at` とスレッドの参照が残ることは、DB を直接見ないと観測できない。API の応答は従来から本文を空にしているので、E2E では区別できない |
| ポストの論理削除 / 消去した本文は検索に当たらない | backend integration test (`internal/httpapi`, `search_integration_test.go`) | PGroonga の索引が UPDATE に追従することは、実際の PostgreSQL + PGroonga でしか確かめられない |
| ポストの論理削除 / 削除後のエクスポートに本文を含めない | backend integration test (`internal/httpapi`) | エクスポートはデータを `COPY` するだけなので、DB の `body` が空であることで担保される。ダンプそのものは CI の外部ツールが作るため、E2E の範囲外とする |
| ポストの論理削除 / 本変更より前に削除されたポスト | backend migration test (`backend/migrations/migrations_test.go`) | `00015` まで適用して本文付きの削除済み行を入れ、`00016` を適用した後の状態を見る。マイグレーションの順序が絡み、UI からは作れない |
| ポストの論理削除 / 削除がサーバーで失敗する | 既存 E2E（`@optimistic-post-create-and-delete`「削除がサーバーで拒否されると行が戻り、再試行で消える」） | 本 change で挙動を変えない |
| ポストの論理削除 / 失敗した削除を再試行する | 既存 E2E（同上） | 同上 |
| ポストの論理削除 / 削除されたポストは取得されない | backend integration test（既存） | 本 change で挙動を変えない |
| ポストの論理削除 / 削除を取り消す | 既存 E2E（`@optimistic-post-create-and-delete`） | 同上 |
| ポストの論理削除 / 削除されたポストは編集できない | backend integration test（既存） | 同上 |
| データのエクスポート / 定期的にエクスポートを取得する | CI（`ops` workflow の `db-dump` を `workflow_dispatch` で実行）+ 運用手順 | スケジューラと GitHub Actions のアーティファクトが対象で、アプリの E2E の範囲外。Migration Plan の手順 5 で、実際に取得・復号して確かめる |
| データのエクスポート / 実行基盤は復号できない | 構成レビュー + ワークフロー内の検査ステップ | 「CI に秘密鍵が無い」ことは振る舞いではなく構成の性質である。ワークフローが秘密鍵も共通鍵も参照しないこと（`secrets.DUMP_PASSPHRASE` の参照が消えていること）を PR のレビューで確かめる。共通鍵による復号経路が無いことは、次行の検査が成果物ごとに保証する |
| データのエクスポート / 暗号化の宛先を検証する | CI のワークフロー内検査（`gpg --list-packets`）+ 検査スクリプトの単体試験 | 検査はワークフロー自身が毎回行う。検査ロジックはスクリプトに切り出す。公開鍵暗号・共通鍵暗号・別鍵宛ての 3 種類の成果物で正しく合否を出すことを、ローカルと CI の両方で走る単体試験で固定する |
| データのエクスポート / エクスポートに失敗する | CI（`set -euo pipefail` と検査失敗時の非ゼロ終了）+ 検査スクリプトの単体試験 | 失敗時にアップロードの step へ進まないことは、ワークフローの構造で担保する。暗号化前のファイルは `trap` で消える |
| データのエクスポート / エクスポートから復旧する | 運用手順（Migration Plan 手順 5） | 秘密鍵は CI の外にしかないので、自動試験では復号できない。切り替え直後に 1 回、手動で復号・展開して確かめる |
| スクリプト実行元の制限 / 他サイトへの埋め込み | 設定のテスト（`vercel.json` の検証）+ デプロイ後の手動確認 | `frame-ancestors` は `<meta>` では効かず、Vercel のヘッダーでしか配られない。`vite preview` は `vercel.json` のヘッダーを再現しない。`vercel.json` に `frame-ancestors 'none'` が残っていることを CI の設定検証で固定し、本番ではデプロイ後に応答ヘッダーを確かめる |

## タグ対応

- すべての実装テストに `@harden-sensitive-data-protection` と `@TP-NNN` を付与すること。
- Playwright のテスト（TP-001〜TP-006）は `{ tag: ['@harden-sensitive-data-protection', '@TP-NNN'] }` で付ける。
- Electron の Node スクリプト（TP-007）は、テスト名とファイル先頭のコメントに同じタグ文字列を書く。
- fixture `mock:account-not-allowed`、`mock:rich-content-post`、`build:pwa-preview`、`build:csp-e2e`、`electron:built-dist` は、apply の際に `frontend/e2e/fixtures/README.md` へ登録する。
