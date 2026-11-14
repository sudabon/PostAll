## 1. 前提と API 契約

- [x] 1.1 main から作業ブランチを切る。`harden-sensitive-data-protection` が main に入っていることを、`git log origin/main` で確認する
- [x] 1.2 `api/openapi.yaml` を更新する。既存の並びと命名に沿っていることを、目視で確認する
  - `Channel` に `encrypted`（boolean、必須）
  - `CreateChannelRequest` に `encrypted`（boolean、既定 false）
  - `Post` に `encrypted`（boolean、必須）と `ciphertext`（string、nullable）
  - `CreatePostRequest` / `EditPostRequest` に `ciphertext`
  - `/v1/encryption/keyring` の `GET` / `POST`
  - `/v1/encryption/keyring/{kind}` の `PUT`（`X-Postall-Key-Proof` ヘッダー）
  - `EncryptionKeyring` / `KeyWrap` のスキーマ
  - design.md D4 のエラーコードの例
- [x] 1.3 `make generate` と `cd frontend && npm run generate` で生成物を更新し、`go build ./...` と `npm run typecheck` が通ることを確認する。`openapi.gen.go` は CI と同じ Go（`go.mod` の版）で生成する

## 2. データベース

- [x] 2.1 `backend/migrations/00017_channel_encryption.sql` を追加する。design.md D3 の内容を入れる。
  - `channels.encrypted` と、`unique (id, encrypted)`
  - 不変性のトリガー
  - `posts.encrypted` / `body_ciphertext`
  - 複合外部キーと CHECK 制約
  - `encryption_keyring`
  - RLS と、権限の剥奪
  - 暗号化チャネルがあれば失敗する Down

  `migrations_test.go` に、次を確かめるテストを追加する。
  - 暗号化チャネルに平文のポスト、非暗号化チャネルに暗号文のポストを入れられない
  - `channels.encrypted` を更新できない
  - 鍵束が 2 行入らない
  - 暗号化チャネルがあると Down が失敗する
- [x] 2.2 `internal/store/queries/` を更新する。
  - `InsertChannel` に `encrypted`
  - `InsertPost` に `encrypted` / `body_ciphertext`
  - `UpdatePostBody` で暗号文を更新
  - `SoftDeletePost` で `body_ciphertext = null`
  - 検索の 2 本に `and not p.encrypted`
  - 鍵束の取得・作成（`on conflict do nothing`）・包みの更新

  `go tool sqlc generate` の後、CI の「Check sqlc generated files」と同じ手順で、差分が無いことを確認する

## 3. バックエンド

- [x] 3.1 `internal/channel` で、作成時に `encrypted` を受け取る。鍵束が無い状態での暗号化チャネルの作成は、409 `encryption_not_configured` にする。チャネルの応答に `encrypted` を載せる。単体テストで確認する
- [x] 3.2 `internal/post` に、design.md D4 の検証規則を実装する。対象チャネルの `encrypted` で、次を分岐する。単体テストで、各規則のエラーコードを確認する
  - 平文と暗号文の取り違えの拒否
  - 暗号文の形式と `keyId` の照合
  - 添付の拒否
  - 鍵束が無い場合の拒否
- [x] 3.3 `fromPost` と応答に、`encrypted` / `ciphertext` を載せる。削除済みのポストでは、暗号文を返さない。単体テストで確認する
- [x] 3.4 鍵束のサービスとハンドラ（`GET` / `POST` / `PUT`）を追加する。所持の証明を SHA-256 で定数時間比較し、不一致なら 403 `key_proof_mismatch` にする。許可リストの内側にあることを、ミドルウェアのテストで確認する
- [x] 3.5 `internal/httpapi` に integration test を追加する。test-plan.md の「E2E対象外」のうち backend に委ねた項目で、次を確かめる。`go test ./internal/httpapi/...` で通ることを確認する
  - 暗号化チャネルの作成と、`encrypted` の応答
  - リネーム・移動で、`encrypted` が変わらない
  - 鍵束が無い状態での暗号化チャネルの作成が 409
  - 暗号化チャネルのポストは `body` が空で、暗号文が保存される
  - 暗号化チャネルへの平文（作成・返信・編集）が 400
  - 非暗号化チャネルへの暗号文が 400
  - 暗号化チャネルへの添付付きの要求が 400
  - 削除で暗号文が消え、スレッドの参照は残る
  - 暗号化チャネルのポストが検索に当たらず、暗号文の文字列にも一致しない
  - 鍵束の同時の初期設定で、1 件だけが成立する（2 件目は 409）
  - 誤った所持の証明での `PUT` が 403 で、鍵束は変わらない
  - 別の `keyId` の暗号文が 400

## 4. フロントエンド: 暗号モジュール

- [x] 4.1 `frontend/src/crypto/keys.ts` を実装する（design.md D1）。
  - マスター鍵の生成
  - PBKDF2 と HKDF による包み鍵の導出
  - AES-GCM での包みと解き
  - HKDF による暗号鍵と所持の証明の導出

  `keys.test.ts` で、次を確認する。
  - 往復できる
  - 誤ったパスフレーズ・復旧キーで解けない
  - 取り出せない形で解いた鍵は `exportKey` できない
  - 包みのパラメータが保存・復元される
- [x] 4.2 `frontend/src/crypto/envelope.ts` を実装する（design.md D2）。`pe1` 形式のエンコードとデコード、AAD、256 バイト単位の詰め物を扱う。`envelope.test.ts` で、次を確認する。
  - 往復できる
  - 1 バイトの改ざんを検出する
  - 別の `keyId` を拒否する
  - 長さが 256 バイト単位になる
  - 未知の版を拒否する
- [x] 4.3 `frontend/src/crypto/recovery-key.ts` を実装する。32 バイトの乱数、Crockford Base32 の 4 文字区切りでの表示、入力の正規化（空白・ハイフン・大小文字）を扱う。単体テストで、往復できることと、誤入力を検出することを確認する。あわせて、4.1〜4.3 のテストで「鍵束と暗号文だけでは復号できない」ことを示す

## 5. プラットフォーム adapter

- [x] 5.1 `PlatformAdapter` に `encryptionKeyStore`（`canPersist` / `save` / `load` / `clear`）を追加する。browser（IndexedDB の `postall-keys`、取り出せない `CryptoKey`）と fake を実装する。単体テストで、保存・復元・削除と、鍵の値が `localStorage` に出ないことを確認する。依存は追加しない。jsdom で IndexedDB が使えない部分は、TP-017 に任せる
- [x] 5.2 Electron に、`secret:persistent` の IPC（`safeStorage.isEncryptionAvailable()`）を追加する。electron adapter では、マスター鍵を `secret:*` に保存する。`electron/test` の単体テストで、`safeStorage` が使えないときに `canPersist()` が false になり、保存されないことを確認する

## 6. フロントエンド: 鍵の状態

- [x] 6.1 `EncryptionProvider` を実装する（design.md D5）。`EncryptionProvider.test.tsx` で状態遷移を確認する。
  - 状態（`unconfigured` / `locked` / `unlocked`）
  - 鍵束の取得
  - 初期設定（409 なら `locked` へ）
  - 解錠（記憶する・しない）
  - ロックと `forget`
  - 復号のキャッシュと世代番号
- [x] 6.2 自動ロックを実装する。記憶しないときだけ、15 分操作が無ければロックする。`visibilitychange` でも経過時間を確かめる。vitest の偽の時計で、15 分未満ではロックされず、15 分でロックされることを確認する
- [x] 6.3 `AuthProvider` の `signOut`（`account_not_allowed` の経路も含む）から、`forget` を呼ぶ。単体テストで、サインアウト後に `encryptionKeyStore` が空になることを確認する

## 7. フロントエンド: 画面

- [x] 7.1 初期設定の画面を実装する。パスフレーズを 2 回入力（12 文字以上）し、復旧キーを表示して、保管を確認してから鍵束を登録する。`SetupEncryptionDialog.test.tsx` で、次を確認する。
  - 短いパスフレーズでは進めない
  - 保管を確認しないと完了できない
  - 409 で解錠へ切り替わる
- [x] 7.2 解錠の画面を実装する。単体テストで、誤った入力のメッセージと遷移を確認する。
  - パスフレーズか復旧キーで解錠する
  - 「この端末で記憶する」を選べる（既定はオフ。`canPersist` が false なら無効にして理由を示す）
  - 復旧キーで解錠したら、新しいパスフレーズの設定へ進める
- [x] 7.3 設定画面に、ロック・パスフレーズの変更・復旧キーの再発行を追加する。いずれも現在のパスフレーズか復旧キーの入力を求め、所持の証明を付けて送る（design.md D7）。単体テストで、送信内容に平文の鍵が含まれないことを確認する
- [x] 7.4 `ChannelTree` のチャネル作成に、「暗号化」の切り替えを追加する（既定オフ）。単体テストで確認する。
  - 鍵束が未設定なら、初期設定を先に行う
  - チャネルツリーの行と、タイムラインの見出しに、暗号化チャネルの印を付ける
  - リネーム・移動の UI に、暗号化を変える操作は出さない
- [x] 7.5 `Composer`（暗号化チャネルとそのスレッド）を変える。`Composer.test.tsx` で確認する。
  - 「暗号化して送信」の表示を出す
  - 添付の操作を出さない
  - 下書きはメモリにだけ置く
  - ロック中は、送信時に解錠を求める（入力は保持する）
  - 非暗号化チャネルでは従来どおりで、暗号化の選択は出さない
- [x] 7.6 `usePosts` の作成・返信・編集を変える。単体テストで、暗号化チャネルの要求に平文が含まれないことを確認する。
  - 暗号化チャネルでは、送信前に暗号文を作り、`ciphertext` で送る
  - 送信待ちのポストは、平文と暗号文の両方を持ち、ロック時に平文を捨てる
  - 再送は暗号文で行う
- [x] 7.7 `PostBody` / タイムライン / スレッドで、暗号化チャネルのポストを表示する。単体テストで 3 つの状態を確認する。
  - `useDecryptedBody` で復号して、既存の `MarkdownBody` へ渡す
  - ロック中と、復号できない場合の表示を出す
  - ロック中は、編集と返信の導線を出さない
- [x] 7.8 `PostEditor` で、暗号化チャネルのポストの編集を扱う。解錠中だけ開け、保存は暗号文で送り、ロック時に閉じる。検索ダイアログのチャネルの絞り込みには、非暗号化チャネルだけを出す。単体テストで確認する

## 8. ドキュメント

- [x] 8.1 ドキュメントを更新する。
  - `ARCHITECTURE.md` の「9. 多層防御」に、暗号化チャネルの節を追加する（鍵の階層、サーバーが持つもの・持たないもの、Web 版がコードの配信を信頼すること、記憶の扱い、チャネル名は平文であること）
  - `API_REFERENCE.md` と `DATABASE_SCHEMA.md` に、新しい項目・API・テーブル・制約を追記する
- [x] 8.2 `DEPLOYMENT.md` と `SETUP_GUIDE.md` に、次を追加する。`grep` で、各語句が入っていることを確認する
  - 暗号化の初期設定（暗号化チャネルの初回作成）の手順
  - 復旧キーを 2 か所に保管すること
  - 会社支給の端末では記憶しないこと
  - 端末を紛失したときの対応（Supabase のセッション失効と許可リスト）
  - 最も秘匿性の高い操作は Electron で行う推奨
  - チャネル名に秘匿情報を入れないこと
  - 既存のメモは投稿し直しが必要なこと

## 9. E2E の fixture

- [x] 9.1 `frontend/e2e/fixtures/encryption.ts` に、テスト用のパスフレーズと復旧キーから、鍵束と暗号文を WebCrypto で組み立てるヘルパーを実装する。改ざんした暗号文と、別の鍵の暗号文も作れるようにする
- [x] 9.2 `installApiMock` に、次を追加する。既存の E2E が回帰しないことを確認する。
  - チャネルの `encrypted`
  - 鍵束の API
  - 暗号化チャネルのポストの保存・取得
  - サーバーと同じ検証規則
  - 受けた全要求の記録

  fixture として、次を作る。
  - `mock:encryption-unconfigured`
  - `mock:encryption-locked`: 暗号化チャネル `secret`（Markdown・コード・Mermaid・スレッドを含む）と、非暗号化チャネル `inbox`
  - `mock:encryption-unlocked`: 上記に、記憶した鍵を事前に置く
  - `mock:encryption-setup-conflict`
  - `mock:encryption-tampered-post`
- [x] 9.3 `clock:idle`（Playwright の時計の制御で、操作の無い時間を進めるヘルパー）を追加する
- [x] 9.4 `frontend/playwright.config.ts` に、WebKit の iPhone エミュレーションの project（`browser:webkit-iphone`）を追加する。対象は TP-032 だけにする。CI の frontend job を `npx playwright install --with-deps chromium webkit` にする。`npx playwright test --list` で認識されることを確認する
- [x] 9.5 `electron:encryption-key-store` を用意する。一時的な `user-data-dir` で Electron を起動し、レンダラから `encryptionKeyStore` を操作する観測用のページを作る
- [x] 9.6 `frontend/e2e/fixtures/README.md` の表に、9.2〜9.5 の fixture について、名前・作られる状態・使用する TP-ID・方式を登録する

## 10. E2E テスト（`@add-client-side-post-encryption`）

- [x] 10.1 TP-001（`@TP-001`）: 暗号化を選んで作ったチャネルが、暗号化チャネルとして作成され、一覧と見出しに印が付くことを、`frontend/e2e/encryption.spec.ts` に実装する。`--grep @TP-001` で確認する
- [x] 10.2 TP-002（`@TP-002`）: 既定で非暗号化チャネルが作られ、印も暗号化の選択も無く、投稿が平文で送られることを実装する。`--grep @TP-002` で確認する
- [x] 10.3 TP-003（`@TP-003`）: 未設定で暗号化チャネルを作ろうとすると初期設定を求められ、鍵束が 1 回だけ登録されてからチャネルが作られることを実装する。`--grep @TP-003` で確認する
- [x] 10.4 TP-004（`@TP-004`）: リネーム・移動の後も暗号化チャネルのままで、投稿が暗号文で送られることを実装する。`--grep @TP-004` で確認する
- [x] 10.5 TP-005（`@TP-005`）: 暗号化チャネルの子を、非暗号化チャネルとして作れることを実装する。`--grep @TP-005` で確認する
- [x] 10.6 TP-006（`@TP-006`）: 暗号化チャネルへの投稿要求に平文が無く暗号文だけがあり、即時に平文で表示され、暗号化の表示が出ることを実装する。`--grep @TP-006` で確認する
- [x] 10.7 TP-007（`@TP-007`）: 暗号化チャネルのスレッドへの返信が、暗号文で送られることを実装する。`--grep @TP-007` で確認する
- [x] 10.8 TP-008（`@TP-008`）: ロック中は解錠まで送信されず、入力が保持され、解錠後に暗号文で送信されることを実装する。`--grep @TP-008` で確認する
- [x] 10.9 TP-009（`@TP-009`）: 一連の操作の全要求に、平文・パスフレーズ・復旧キーが現れないことを実装する。`--grep @TP-009` で確認する
- [x] 10.10 TP-010（`@TP-010`）: 短いパスフレーズや保管の未確認では初期設定が完了せず、登録や作成の要求が出ないことを実装する。`--grep @TP-010` で確認する
- [x] 10.11 TP-011（`@TP-011`）: 初期設定の確定時に 409 が返ると、既存の鍵を置き換えずに解錠へ切り替わることを実装する。`--grep @TP-011` で確認する
- [x] 10.12 TP-012（`@TP-012`）: 別の端末で作った暗号化チャネルのポスト（Markdown・コード・Mermaid）が、ロック中の表示の導線から解錠すると、再読み込みなしで描画されることを実装する。`--grep @TP-012` で確認する
- [x] 10.13 TP-013（`@TP-013`）: 誤ったパスフレーズでは解錠されず、本文が出ないことを実装する。`--grep @TP-013` で確認する
- [x] 10.14 TP-014（`@TP-014`）: 復旧キーで解錠でき、新しいパスフレーズの設定へ促されることを実装する。`--grep @TP-014` で確認する
- [x] 10.15 TP-015（`@TP-015`）: 記憶しないで解錠した後に開き直すと、ロック中になることを実装する。`--grep @TP-015` で確認する
- [x] 10.16 TP-016（`@TP-016`）: 記憶して解錠した後に開き直すと、パスフレーズなしで表示されることを実装する。`--grep @TP-016` で確認する
- [x] 10.17 TP-017（`@TP-017`）: 記憶した鍵の値を取り出せず、秘密の値がストレージに平文で無いことを実装する。`--grep @TP-017` で確認する
- [x] 10.18 TP-018（`@TP-018`）: 記憶しない設定で 15 分操作が無いとロックされ、15 分未満ではロックされないことを実装する。`--grep @TP-018` で確認する
- [x] 10.19 TP-019（`@TP-019`）: 手動でロックすると、直ちにロック中になり、開き直しても解錠を求められることを実装する。`--grep @TP-019` で確認する
- [x] 10.20 TP-020（`@TP-020`）: 編集中に自動ロックが起きると、編集フォームが閉じて平文が残らないことを実装する。`--grep @TP-020` で確認する
- [x] 10.21 TP-021（`@TP-021`）: サインアウト後に再びサインインすると、ロック中で、鍵がストレージに無いことを実装する。`--grep @TP-021` で確認する
- [x] 10.22 TP-022（`@TP-022`）: ロック中の暗号化チャネルで本文が出ず、解錠の導線があり、編集と返信の導線が無いことを実装する。`--grep @TP-022` で確認する
- [x] 10.23 TP-023（`@TP-023`）: ロック中でも、非暗号化チャネルは解錠なしで表示・投稿できることを実装する。`--grep @TP-023` で確認する
- [x] 10.24 TP-024（`@TP-024`）: 改ざんした暗号文と別の鍵の暗号文が、復号できないものとして示され、他のポストは正しく表示されることを実装する。`--grep @TP-024` で確認する
- [x] 10.25 TP-025（`@TP-025`）: 暗号化チャネルのポストの編集で、新しい暗号文だけが送られることを実装する。`--grep @TP-025` で確認する
- [x] 10.26 TP-026（`@TP-026`）: パスフレーズの変更後は、古いパスフレーズで解錠できず、新しいパスフレーズで解錠でき、既存のポストが読めることを実装する。`--grep @TP-026` で確認する
- [x] 10.27 TP-027（`@TP-027`）: 復旧キーの再発行後は、古い復旧キーで解錠できず、新しい復旧キーで解錠できることを実装する。`--grep @TP-027` で確認する
- [x] 10.28 TP-028（`@TP-028`）: 暗号化チャネルとそのスレッドで添付の操作が無く、非暗号化チャネルには残ることを実装する。`--grep @TP-028` で確認する
- [x] 10.29 TP-029（`@TP-029`）: 暗号化チャネルの下書きが、開き直しても復元されず、ストレージにも残らないことを実装する。`--grep @TP-029` で確認する
- [x] 10.30 TP-030（`@TP-030`）: 暗号化チャネルの下書きが、開き直さないチャネルの切り替えでは復元されることを実装する。`--grep @TP-030` で確認する
- [x] 10.31 TP-031（`@TP-031`）: 暗号化チャネルの未送信の本文が、ロックで入力欄から消えることを実装する。`--grep @TP-031` で確認する
- [x] 10.32 TP-032（`@TP-032`）: WebKit の iPhone エミュレーションで、記憶して解錠して表示でき、開き直してもパスフレーズを求められないことを実装する。`--grep @TP-032` で確認する
- [x] 10.33 TP-033（`@TP-033`）: Electron で記憶した鍵が再起動後も取り出せ、保存ファイルに鍵の値が平文で現れないことを、`electron/test/encryption-key-store.e2e.mjs` に実装する。テスト名とファイル先頭のコメントにタグを書き、`electron/package.json` の `test` に追加する。`cd electron && npm test` で確認する

## 11. 検証

- [x] 11.1 次がすべて通ることを確認し、ログを残す。
  - `cd backend && go vet ./... && go test ./...`
  - `cd frontend && npm run typecheck && npm run lint && npm test && npm run build && npm run test:e2e`
  - `cd electron && npm test`
- [x] 11.2 `node scripts/e2e-report.mjs add-client-side-post-encryption frontend/test-results/e2e-results.json` で、TP-001〜TP-032 のカバレッジ欠落が無いことを確認する。あわせて、`openspec validate add-client-side-post-encryption --strict` が通ることを確認する
- [x] 11.3 ローカルの Supabase スタックで、API と web（本番ビルド）を起動し、次を手動で確認する。
  - 暗号化チャネルの作成（初期設定を含む）→ 投稿 → 別のブラウザのプロファイルで解錠して表示
  - `psql` で、暗号化チャネルの `posts.body` が空で、`body_ciphertext` だけがあること
  - Electron で、同じパスフレーズで解錠して表示できること

## 12. 運用（マージ後）

- [ ] 12.1 【運用者】`migrate` workflow で `00017` を適用し、`deploy` workflow でデプロイする。Electron を再ビルドして配布する。既存のチャネルとポストが、従来どおり表示・投稿できることを確認する
- [ ] 12.2 【運用者】個人用 Mac（Electron）で暗号化チャネルを作成して、初期設定を行う。復旧キーを、CI の外の 2 か所に保管する
- [ ] 12.3 【運用者】次の 3 台で、同じパスフレーズで解錠して、暗号化チャネルのポストが表示されることを確認する。会社支給 Mac では、15 分の無操作で自動ロックされることも確認する。
  - 個人用 iPhone（PWA）
  - 会社支給 Mac（ブラウザ、記憶しない設定）
  - 個人用 Mac（Electron）
- [ ] 12.4 【運用者】復旧キーで解錠して、パスフレーズを再設定できることを 1 回試す（復旧手順の予行）
