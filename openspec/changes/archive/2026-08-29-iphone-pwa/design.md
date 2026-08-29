## Context

React フロントエンドは Electron と PWA で共有し、差異は `frontend/src/platform/` のアダプタに閉じている。PWA は `vite-plugin-pwa` で manifest（`display: standalone`）と Service Worker を出し、`https://memo.sudabon.com` から同一オリジンで API と一緒に配信している。認証は GitHub → Supabase の PKCE で、ブラウザは `window.location.assign` で認可 URL へ飛び、`/auth/callback` に戻る。

現状の iPhone 向けギャップは次の 3 点に集約される。

1. `AppShell` が `min-w-[800px]` の 3 ペイン固定で、iPhone 幅では横スクロールになる。狭幅レイアウトは UI 刷新時に明示的にスコープ外とされた。
2. ブラウザのトークンは `sessionStorage`（とメモリ）のみ。タブ終了・スタンドアロン PWA のプロセス破棄で毎回サインインし直す。仕様も「永続 web ストレージへ平文で保存してはならない」と禁止している。
3. `apple-mobile-web-app-capable` や `viewport-fit=cover` がなく、iOS の「ホーム画面に追加」を第一級として扱っていない。当初の決定は「Flutter があるので iOS PWA は想定しない」だった。

Flutter の `mobile-shell` は既に「チャネル一覧 → タイムライン → スレッド」の階層ナビゲーションとキーボード／セーフエリア要件を持っている。本設計はそれを React 側へ移植し、証明書が要らない経路を実用化する。

対象ブラウザの下限は **iOS 16.4**（ホーム画面 Web アプリの Service Worker と、Safari から隔離されたストレージ）。それ以前の Safari でも URL を開けば使えるが、スタンドアロンと SW は保証しない。

## Goals / Non-Goals

**Goals:**

- iPhone の Safari、および「ホーム画面に追加」したスタンドアロン PWA から、チャネルの閲覧・投稿・スレッド・添付・検索が一人で完結すること。
- 狭幅では Flutter と同じ階層ナビゲーション、十分な幅では現行 3 ペインを維持すること。
- 一度サインインしたブラウザ／PWA が、タブやアプリの再起動後もリフレッシュトークンで復元されること。
- iOS のホームインジケータ・ノッチ・ソフトキーボードで、入力フォームが隠れないこと。

**Non-Goals:**

- Flutter アプリの改修・廃止、App Store 配布、Apple Developer Program の導入。
- バックエンド API、CORS 方針、認可方式（Bearer）の変更。httpOnly Cookie セッションへの移行。
- オフライン編集・投稿キュー。アプリシェルの SW キャッシュ方針は現行のまま。
- Web Push / バッジ / バックグラウンド同期。
- `react-router` 等の本格ルーティング導入、チャネル URL の公開共有。
- Electron の `safeStorage`、iOS の Keychain の変更。
- GitHub ドメインへ遷移した瞬間に iOS がスタンドアロン PWA を Safari へ切り替える制約そのものの解消（OS の制限）。

## Decisions

### 1. 狭幅シェルは Flutter と同じ 3 段スタックにする

幅が `768px` 未満（Tailwind `md` 未満、iPhone 縦向きが該当）のとき、同時に 1 画面だけを出す。

| 画面 | 出す条件 | 戻る先 |
|---|---|---|
| チャネル一覧 | スタック先頭。選択チャネルはハイライトだけ | — |
| タイムライン | チャネルを開いたあと | チャネル一覧（選択は残す） |
| スレッド | スレッドを開いたあと | タイムライン |

`768px` 以上は現行の 3 ペイン（サイドバー + タイムライン + 任意のスレッド併置）を維持する。リサイズで閾値をまたいだら、その場の `selectedChannelId` / `threadPostId` を保ったままレイアウトだけ切り替える。

**根拠**: `mobile-shell` の要件を Web に写す方が、iPhone 常用者のメンタルモデルが Flutter と一致する。ハンバーガー付き 3 ペイン縮小は、タイムラインとツリーが同時に見えないのにクロームだけ残る中途半端な形になる。

**代替案**:
- *サイドバーをドロワーにする*: 実装は小さいが、チャネル切り替えのたびにドロワー操作が入り、Flutter ともデスクトップとも違う第三の UI になる。
- *閾値を 800px にする*: 現行 `min-w-[800px]` に揃う一方、Tailwind の `md` とずれ、テストビューポートが中途半端になる。

状態は Zustand の `narrowScreen: 'channels' | 'timeline' | 'thread'` を足す。`selectChannel` は狭幅では timeline へ進み、`openThread` は thread へ進む。チャネル一覧へ戻る操作は `selectedChannelId` を消さず `narrowScreen` だけ戻す（Flutter の「直前のチャネルを強調」と同じ）。このキーは永続化しない。起動時は保存済みの `selectedChannelId` があれば timeline、スレッド ID は保存していないので channels/timeline から始める。

### 2. 狭幅の戻る操作は History API に載せる（ルータライブラリは入れない）

狭幅での「チャネルを開く」「スレッドを開く」は `history.pushState` する。ブラウザ／iOS の戻るジェスチャと戻るボタンは `popstate` でスタックを戻す。URL パスは `/` のまま、`history.state` に画面種別だけを置く。OAuth の `/auth/callback` は現行どおりコールバック処理後に `replaceState` で `/` へ戻す。

広いビューポートではペイン操作で history を積まない（現行どおり）。

**根拠**: iPhone ユーザーは画面左端スワイプで戻る。アプリ内ボタンだけのスタックは OS の戻ると衝突し、PWA を閉じたり Safari の前のページへ出てしまう。フルのルータは OAuth・検索・E2E の書き換えが大きく、この change の目的を超える。

**代替案**:
- *アプリ内戻るボタンのみ*: 実装は最小だが、iOS のスワイプ戻ると衝突する。
- *パスを `/c/:id` にする*: 共有 URL にはなるが、サーバフォールバック・E2E・OAuth の整理が要る。後続 change に送る。

### 3. ブラウザのシークレット保管を `localStorage` へ移す

`createBrowserAdapter` の `getSecret` / `setSecret` / `deleteSecret` を、`sessionStorage` から `localStorage`（キー `postall:secret:<name>`）へ変更する。PKCE verifier は既に `setItem`（localStorage）へも書いており、トークンだけがセッション限定だったねじれを解消する。メモリ上の `Map` は起動中のフォールバックとして残す（プライベートモード等）。

Electron アダプタは `safeStorage` のまま。アクセストークンの更新ロジック（期限 60 秒前に refresh）は変えない。サインアウトと refresh の 400/401 でシークレットを消す挙動も変えない。

**根拠**: iOS のスタンドアロン PWA はプロセスが死ぬと `sessionStorage` が空になる。常用に耐えるにはリフレッシュトークンの永続化が必須。既に PKCE を localStorage に置いている以上、同 origin・同 XSS 面にトークンを足す増分は小さい。IndexedDB は容量と非同期 API の利点があるが、数 KB のトークンには過剰で、既存の `getItem` 同期パターンとも合わない。

**代替案**:
- *httpOnly Cookie セッション*: XSS 耐性は上がるが API と CORS／CSRF を作り直す。Non-Goal。
- *スタンドアロンのときだけ永続化する*: `display-mode: standalone` 検出は初回サインインが Safari タブで行われると効かず、実装分岐だけが増える。
- *Web Crypto で包む*: 暗号化キーの置き場が同じ localStorage になり、XSS に対して実効性が無い。

仕様上は「アクセストークンを永続 web ストレージへ平文で保存しない」を、ブラウザ経路に限り「リフレッシュトークンを origin スコープの永続ストレージへ保存してよい。アクセストークンはメモリを優先し、実装都合で同じレコードに含めてよい」へ更新する。現行実装の `TokenSet` JSON（access + refresh + expiresAt）を 1 レコードで保存する今の形を維持する。

### 4. iOS インストール用メタとセーフエリアを HTML / CSS に足す

`frontend/index.html` に次を入れる。

- `apple-mobile-web-app-capable` / `mobile-web-app-capable`
- `apple-mobile-web-app-title`（PostAll）
- `apple-mobile-web-app-status-bar-style` は `black-translucent`（コンテンツをノッチ下まで伸ばし、既存の半透明クロームと整合させる）
- `viewport` に `viewport-fit=cover`
- 既存の `apple-touch-icon`（192px）を維持する。180px 専用ファイルは、既存 192 が iOS に受け取られるため必須としない

`index.css` で `env(safe-area-inset-*)` をヘッダー・チャネル一覧・コンポーザ下端に適用する。ソフトキーボードは `visualViewport` の `resize` / `scroll` で下端インセットを更新し、`interactive-widget` に依存しない（iOS Safari の対応が不安定なため）。

既存の `h-dvh` は維持する。

**代替案**: ステータスバーを `default` の不透明にする案は、浮遊クロームの意匠と衝突するので採らない。

### 5. タッチでのチャネル DnD は長押し起動にする

チャネルツリーは `PointerSensor` の `distance: 6` でドラッグを開始しており、縦スクロールと衝突する。狭幅では `@dnd-kit` の delay 制約（おおよそ 250ms + 許容移動）を Pointer/Touch センサに付け、誤ドラッグを防ぐ。広いビューポートのマウス操作（`distance: 6`）は維持する。

### 6. 添付はブラウザ標準のファイル選択のままにする

`input type=file` は iOS Safari で写真ライブラリとファイルアプリを出せる。`capture` 属性による直接カメラ起動は追加しない（ライブラリ経由で十分で、権限ダイアログの分岐を増やさない）。Flutter 側のカメラ専用導線とは差が残ることを許容する。

### 7. コンポーザの送信は現行の「ボタン / Shift+Enter、素の Enter は改行」を維持する

iPhone のソフトウェアキーボードに Enter 送信は無い。現行実装はモバイル向きなので、post-composer の「Enter で送信」文言と実装の差は、この change では仕様を実装に寄せず、狭幅では送信ボタンが主操作であることを `web-narrow-shell` 側で述べるに留める。

## Risks / Trade-offs

- **[Risk] iOS が GitHub へ遷移した瞬間にスタンドアロン PWA を Safari へ切り替える** → 同一 origin に戻ったあとのセッションは Safari 側のストレージに入る。ホーム画面アイコン側は iOS 16.4 以降ストレージが隔離されているためログインが共有されない。緩和: サインインは常に今開いているコンテキスト（Safari またはスタンドアロン）の中で完了させる。スタンドアロンで外部ブラウザが開いた場合は、そちらで使い続けるか、ホーム画面アプリに戻って再度サインインする旨をサインイン画面の短い注記にする。Cookie セッション化はしない。
- **[Risk] リフレッシュトークンの平文永続化** → XSS で盗まれる。緩和: 対象は HTTPS の同一オリジンに限る。Electron / Flutter は安全領域のまま。httpOnly 化は別 change。プライベートモードではメモリのみ（既存）。
- **[Risk] Safari の未使用サイトデータ削除（おおむね 7 日）** → ホーム画面に追加した PWA は期限が緩い。Safari タブのみの利用では再ログインがあり得る。INSTALL / README に「常用するならホーム画面に追加」と書く。
- **[Risk] History API と OAuth の `replaceState` が干渉する** → コールバック処理は既存どおり URL を `/` に戻してから通常起動する。狭幅スタックの push はサインイン後のシェル表示以降に限る。
- **[Risk] 768px 前後のリサイズでレイアウトが跳ぶ** → 閾値は `matchMedia` 1 本。Electron の狭いウィンドウも同じ。アニメーションで 3 ペインとスタックをモーフィングしない。
- **[Risk] Playwright が iOS Safari を実機再現できない** → 狭幅は `390x844` ビューポートの Chromium E2E でナビゲーションとセーフエリア相当のレイアウトを見る。OAuth の iOS 退避は実機確認チェックリストに残す。

## Migration Plan

1. フロントエンドのみの変更なので、API と DB の移行は無い。
2. 既存のブラウザ利用者は、デプロイ後の初回アクセスで SW が更新され、次回以降トークンが localStorage に残る。旧 `sessionStorage` のトークンは移行せず、一度サインインし直せばよい（残存しても害は無いが読まない）。
3. ロールバックはフロントの再デプロイ。localStorage に残った `postall:secret:*` は次の版が読まなければ無視される。
4. Flutter 利用者への強制移行はしない。

## Open Questions

なし。iOS の OAuth 退避は OS 制約として Decision 3 / Risks に織り込み済み。チャネルのパス付き URL は Non-Goal。
