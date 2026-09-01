# インストール

PostAll を手元の端末へ入れる手順。macOS はビルドした Electron アプリを `/Applications` へ置く。iPhone は Safari（またはホーム画面に追加した PWA）で、証明書は不要。どちらも本番の API（`https://memo.sudabon.com`）を見る。

ローカルスタックへ繋いで開発する場合は [README.md](README.md) の「ローカル起動」を参照。

## iPhone（Safari / ホーム画面 PWA）

証明書や Xcode は不要。iOS 16.4 以降を想定する（ホーム画面 Web アプリの Service Worker と、Safari から隔離されたストレージ）。

1. iPhone の Safari で `https://memo.sudabon.com` を開く
2. 共有メニューから **ホーム画面に追加** する（常用するならこの手順を推奨。Safari タブだけの利用では、未使用サイトデータの削除で再ログインが起きやすい）
3. 初回のサインインは、**今開いている画面の中で完了する**。ホーム画面から起動したアプリで GitHub が Safari に切り替わった場合は、そちら（Safari）で使い続けるか、ホーム画面のアプリに戻ってもう一度サインインする。ホーム画面アプリと Safari タブではサインイン状態が共有されない
4. チャネルの閲覧・投稿・スレッドは、狭い画面では「チャネル一覧 → タイムライン → スレッド」の階層で操作する

## 事前に用意するもの

| | macOS デスクトップアプリ |
|---|---|
| ビルドする Mac | Node.js 22+ |
| インストール先 | macOS 11 以降 |
| Apple の署名 | 不要（未署名のまま自分の Mac へ置く） |

---

## macOS デスクトップアプリ

### 1. フロントエンドを本番向けにビルドする

```bash
cd frontend
npm ci
VITE_SUPABASE_URL=https://<project-ref>.supabase.co \
VITE_SUPABASE_PUBLISHABLE_KEY=<publishable-key> \
  npm run build
```

`frontend/.env.local` があっても、コマンド行で渡した `VITE_*` が優先される。

**`VITE_API_BASE_URL` は渡さない。** Electron は `frontend/dist` を `app://localhost` から読むため、ここに API の絶対 URL を入れるとクロスオリジンになる。API は CORS ヘッダを返さない（ブラウザ版は `memo.sudabon.com` が frontend と API を同一オリジンで配信する構成、iOS は CORS の適用外）ので、レンダラからの直接呼び出しは必ずブロックされる。

代わりに `electron/main.mjs` がメインプロセスで `/health`・`/ready`・`/v1/*` を上流の API へ中継する。メインプロセスの `net.fetch` は CORS の制約を受けないため、レンダラからは同一オリジンに見える。上流の既定は `https://memo.sudabon.com` で、`POSTALL_API_BASE_URL` 環境変数で差し替えられる。

### 2. .app を作る

```bash
cd ../electron
npm ci
npm run pack
```

Apple Silicon なら `electron/dist/mac-arm64/PostAll.app`、Intel なら `electron/dist/mac/PostAll.app` ができる。electron-builder は `electron/build/icon.icns` をアプリアイコンとして、手順 1 の `frontend/dist` を `Contents/Resources/frontend` として取り込む。

`Developer ID Application` の証明書がないため「skipped macOS application code signing」と出るが、手元で使う分には問題ない。

### 3. `/Applications` へ置く

```bash
rm -rf /Applications/PostAll.app
cp -R dist/mac-arm64/PostAll.app /Applications/
```

### 4. 初回起動

未署名・未公証なので Gatekeeper に止められる。どちらかで解除する。

- Finder で `/Applications/PostAll.app` を **右クリック → 開く** を選び、ダイアログの「開く」を押す
- または隔離属性を外してから普通に起動する

  ```bash
  xattr -dr com.apple.quarantine /Applications/PostAll.app
  ```

### 5. 接続を確かめる

サインインしてチャネルが読めれば API に届いている。画面下部に「接続されていません。変更操作は利用できません」が出る場合は API へ到達できていない。

アプリ内の **設定** で `Supabase プロジェクト URL` / `Supabase publishable key` を上書きできる。ここで入れた値はビルド時に埋め込んだ値より優先され、`postall-store.json` に永続化される。

**`API 接続先` は空のままにする。** 埋めるとその絶対 URL へレンダラが直接リクエストし、上の CORS の問題に戻る。上流を変えたいときは、アプリを起動する側で `POSTALL_API_BASE_URL` を渡す。

保存先は次の 2 つ。ディレクトリ名は `electron/package.json` の `name` に由来する。トークンは macOS の `safeStorage` で暗号化される。

```
~/Library/Application Support/postall-desktop/postall-store.json    # 設定とウィンドウ位置
~/Library/Application Support/postall-desktop/postall-secrets.bin   # 暗号化されたトークン
```

### 更新する

フロントエンドを変えたら手順 1 → 2 → 3 をやり直す。`cp -R` は既存の `.app` へ中途半端に重なるので、手順 3 のとおり先に消してからコピーする。

---

## アプリアイコン

どちらの経路も同じチェックリスト型のアイコンを使う。ビルド時に自動で取り込まれるので、通常は触らなくてよい。

| 経路 | ファイル |
|---|---|
| macOS | `electron/build/icon.icns` |
| ブラウザ / PWA | `frontend/public/icon.svg`、`frontend/public/favicon.svg`、`frontend/public/icons/icon-{192,512}.png` |

マスクの流儀が経路ごとに違うため、同じ絵を 2 通りに出し分けている。web は角丸の全面、macOS は 1024 のキャンバスに 824 の角丸スクエアを中央配置。

---

## つまずいたとき

### macOS

| 症状 | 原因と対処 |
|---|---|
| 「開発元を検証できないため開けません」 | 未署名アプリの Gatekeeper。手順 4 の右クリック → 開く、または `xattr -dr com.apple.quarantine` |
| ウィンドウが真っ白のまま | `frontend/dist` が無い状態で `npm run pack` した。手順 1 からやり直す |
| 「接続されていません。変更操作は利用できません」と出る | API へ到達できていない。アプリ内の設定で `API 接続先` が空か確認する（値が入っていると CORS で必ず失敗する）。空でも出るなら `POSTALL_API_BASE_URL` の指す上流に届いているかを確認する |
| アイコンが Electron の既定のまま | `electron/build/icon.icns` が無い。`electron/package.json` の `build.mac.icon` が指す先を確認する |
