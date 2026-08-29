## Why

無料 Apple ID で署名した Flutter iOS アプリはプロビジョニングが 7 日で失効し、常用の配布手段にならない。一方でブラウザ向け PWA は HTTPS で既に配信されているが、当初「iOS での PWA 利用は想定しない」と決めており、トークンがタブを閉じると消え、シェルは `min-w-[800px]` の 3 ペインのままなので、iPhone では実用に耐えない。証明書なしで iPhone から同じメモを読み書きできるようにする。

## What Changes

- **iPhone Safari / ホーム画面 PWA を第一級の利用経路にする。** Flutter アプリは残し、有償の Developer Program を持つ場合の選択肢とする。本 change で Flutter を置き換えたり削除したりしない。
- **狭幅向けナビゲーションを React シェルへ入れる。** 十分な幅では現行の 3 ペインを維持し、iPhone 幅では Flutter と同様に「チャネル一覧 → タイムライン → スレッド」の階層遷移へ畳む。`min-w-[800px]` を廃止する。
- **ブラウザのサインイン状態を、タブやスタンドアロン PWA の再起動をまたいで復元する。** 現状はトークンを `sessionStorage` のみに置いているため、iPhone ではほぼ毎回 GitHub サインインが必要になる。
- **iOS 向けのインストール可能性を揃える。** Web App Manifest に加え、`apple-mobile-web-app-*`、`viewport-fit=cover`、セーフエリア、適切な `apple-touch-icon` を入れ、Safari の「ホーム画面に追加」でスタンドアロン起動できるようにする。
- **OAuth を同一ドキュメント遷移のまま完結させる。** サインインは現行どおり `window.location.assign` によるフルページ遷移とする。iOS が GitHub ドメインへ出た瞬間に Safari へ逃がす既知の制限は、設計上の制約として扱い、バックエンドのセッション Cookie 化やカスタム URL スキームでの PWA 復帰は本 change の対象外とする。
- バックエンド API、データモデル、Electron の `safeStorage`、Flutter の Keychain は変更しない。

## Capabilities

### New Capabilities

- `web-narrow-shell`: React フロントエンド（PWA / ブラウザ / 小さな Electron ウィンドウ）における狭幅レイアウト。チャネル一覧・タイムライン・スレッドの階層遷移、戻る操作、ソフトキーボードと入力フォームの共存、セーフエリアの尊重。

### Modified Capabilities

- `pwa-delivery`: iOS Safari からのホーム画面追加とスタンドアロン起動を要件に含める。ブラウザで開いたときの「常に 3 ペイン」前提を、幅に応じたシェルへ変更する。
- `authentication`: ブラウザ（PWA）がリフレッシュトークンを origin の永続 web ストレージへ保存し、再訪時にサインイン状態を復元できるようにする。平文永続化禁止の現行要件を、ブラウザ経路に限って緩和する。
- `desktop-shell`: 3 ペイン要件を「十分な幅のビューポート」に限定する。狭幅では `web-narrow-shell` に委譲し、固定の最小幅で横スクロールさせることを禁止する。

## Impact

- **コード**: `frontend/src/components/layout/AppShell.tsx`、チャネルツリー / タイムライン / スレッド / コンポーザ、`frontend/src/platform/browser.ts`（トークン保管）、`frontend/src/auth/*`、`frontend/index.html`、`frontend/vite.config.ts`（manifest / iOS メタ）、`frontend/src/index.css`（セーフエリア）。関連する Vitest / Playwright。
- **API・バックエンド**: 変更なし。認可は現行の Bearer トークンのまま。
- **セキュリティ方針**: ブラウザ経路のみ、リフレッシュトークンを origin スコープの永続ストレージへ平文で置く。XSS があれば盗まれる点は SPA の既存前提と同じ。Electron / Flutter の保管方式は変えない。
- **他プラットフォーム**: Electron は同じフロントエンドを同梱するため、狭いウィンドウでも狭幅シェルになる。Flutter（`mobile/`）は対象外。
- **ドキュメント**: `README.md` / `INSTALL.md` / `ARCHITECTURE.md` に、iPhone では PWA（Safari またはホーム画面）を常用経路として追記する。
- **運用**: 追加の証明書・ストア審査・Apple Developer Program は不要。iOS 16.4 以降のホーム画面 Web アプリ（Service Worker と隔離ストレージ）を対象の下限とする。
