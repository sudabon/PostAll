## 1. iOS インストール用メタとセーフエリア

- [x] 1.1 `frontend/index.html` に `apple-mobile-web-app-capable`、`mobile-web-app-capable`、`apple-mobile-web-app-title`、`apple-mobile-web-app-status-bar-style`（`black-translucent`）を追加する
- [x] 1.2 viewport に `viewport-fit=cover` を追加する。既存の `apple-touch-icon` と manifest の `display: standalone` は維持する
- [x] 1.3 `frontend/src/index.css` に `env(safe-area-inset-*)` をヘッダー・リスト下端・コンポーザ下端へ適用する
- [x] 1.4 Playwright で `/manifest.webmanifest` と HTML メタが配信されることを `frontend/e2e/pwa.spec.ts` に足す

## 2. ブラウザのトークン永続化

- [x] 2.1 `frontend/src/platform/browser.ts` の `getSecret` / `setSecret` / `deleteSecret` を `localStorage`（キー `postall:secret:`）へ切り替える。メモリ `Map` はプライベートモード用フォールバックとして残す
- [x] 2.2 `frontend/src/platform/browser.test.ts` を、設定もトークンも localStorage に残ること、`sessionStorage` には置かないことに更新する
- [x] 2.3 サインアウトと refresh の 400/401 で `postall:secret:auth.tokens` が消えることを既存の auth テストで確認し、足りなければ足す
- [x] 2.4 Playwright の PWA サインイン E2E に、リロード後もチャネルツリーが出る（セッションが復元される）ケースを追加する

## 3. 狭幅シェルの状態と履歴

- [x] 3.1 `frontend/src/state/ui.ts` に `narrowScreen: 'channels' | 'timeline' | 'thread'` を追加する。永続化キーには含めない
- [x] 3.2 狭幅での `selectChannel` は `narrowScreen` を `timeline` にし、`openThread` は `thread` にする。チャネル一覧へ戻る操作は `selectedChannelId` を消さず `channels` に戻す
- [x] 3.3 起動時、保存済み `selectedChannelId` があれば狭幅の初期画面を `timeline` にする
- [x] 3.4 768px 未満での画面遷移だけ `history.pushState` し、`popstate` で `narrowScreen` を戻す。広いビューポートでは積まない
- [x] 3.5 OAuth コールバックの `replaceState('/', …)` が狭幅スタックと干渉しないことを auth テストで確認する
- [x] 3.6 `narrowScreen` と history の単体テストを書く（進む / 戻る / 幅をまたいでも選択チャネルが残る）

## 4. AppShell の狭幅レイアウト

- [x] 4.1 `AppShell.tsx` の `min-w-[800px]` を削除する
- [x] 4.2 `matchMedia('(min-width: 768px)')` で広幅 3 ペインと狭幅スタックを切り替える。リサイズで閾値をまたいでも `selectedChannelId` / `threadPostId` を維持する
- [x] 4.3 狭幅のチャネル一覧・タイムライン・スレッドを全幅の単画面として出し、同時に並べない
- [x] 4.4 狭幅のタイムライン／スレッドヘッダーに戻るボタンを置き、チャネル名を表示する
- [x] 4.5 既存の `data-testid`（`sidebar`、`channel-tree`、`channel-title` など）を広幅で維持し、狭幅用の testid が要る箇所だけ足す
- [x] 4.6 広幅のサイドバー折りたたみ・境界ドラッグ・スレッド併置が、768px 以上で従来どおり動くことを既存テストで確認する

## 5. キーボード・タッチ・コンポーザ

- [x] 5.1 `visualViewport` の `resize` / `scroll` でコンポーザ下端のインセットを更新し、ソフトキーボードに隠れないようにする
- [x] 5.2 狭幅では送信ボタンを主操作とし、素の Enter は改行のままにする（現行 `Composer` を維持）
- [x] 5.3 チャネルツリーの DnD を、狭幅では長押し（delay 約 250ms）起動、広幅マウスは現行の `distance: 6` のままにする
- [x] 5.4 狭幅のチャネル一覧をすぐに縦スワイプしてもドラッグが始まらないことのテストを足す

## 6. サインイン画面の注記

- [x] 6.1 `display-mode: standalone`（または `navigator.standalone`）のとき、サインイン画面にストレージ隔離と「別ブラウザが開いたらそちらで続ける／ホーム画面アプリで再度サインイン」の短い注記を出す
- [x] 6.2 ブラウザタブ（standalone でない）ではその注記を出さない

## 7. ドキュメント

- [x] 7.1 `README.md` の 3 経路説明に、iPhone の常用は Safari / ホーム画面 PWA であること、Flutter は有償署名向けの選択肢であることを追記する
- [x] 7.2 `INSTALL.md` に iPhone で PWA を使う手順（Safari で開く、ホーム画面に追加、初回サインインは開いているコンテキストで完了する）を追加する
- [x] 7.3 `ARCHITECTURE.md` のクライアント表と「iOS PWA は想定しない」に相当する記述を、本 change の方針へ更新する

## 8. 検証

- [x] 8.1 Playwright に `390x844` ビューポートの E2E を追加する。チャネル選択 → タイムライン → スレッド → 戻る、の階層遷移を通す
- [x] 8.2 同じ E2E でページが横スクロールを強制されていないこと（`scrollWidth <= clientWidth`）を確認する
- [x] 8.3 広幅ビューポートの既存 E2E（3 ペイン、サインイン、PWA マニフェスト）が落ちないことを確認する
- [x] 8.4 `frontend` で `npm run lint`、`npm run typecheck`、`npm test`、`npm run test:e2e` を実行して通す
- [x] 8.5 Electron を狭いウィンドウと広いウィンドウの両方で起動し、レイアウト切替とトークン保管（`safeStorage`）が壊れていないことを確認する
- [x] 8.6 iPhone 実機の Safari で `https://memo.sudabon.com` を開き、サインイン・投稿・ホーム画面追加・再起動後のセッション復元を確認する（GitHub が Safari へ退避するケースを含む）
