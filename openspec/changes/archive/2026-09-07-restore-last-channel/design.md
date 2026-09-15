## Context

選択中チャネルは `frontend/src/state/ui.ts` の zustand ストア `useUi` が `selectedChannelId` として持つ。永続化は `persistedKeys` に列挙したキーだけを `PlatformAdapter` の `ui` キーへ JSON で書き出す仕組みで、ブラウザは `localStorage`（`postall:ui`）、Electron は `persist:*` IPC 経由で `postall-store.json` へ保存する。いずれも端末ローカルであり、サーバへは同期しない。

`selectedChannelId` は当初 `persistedKeys` に含まれていたが、コミット `c0679c8`（2026-08-29、`iphone-pwa` 系の作業中）で除外された。当時の意図は「起動時は全デバイスでチャネル一覧から始める」であり、狭幅で復元したタイムラインから戻る操作を行うとアプリの外へ出てしまう問題を、復元そのものをやめることで回避したものと読める。結果として `channel-hierarchy` / `desktop-shell` / `web-narrow-shell` の 3 つの仕様が要求する復元が実装されていない状態が続いている。

本変更は復元を戻したうえで、当時回避した問題（狭幅の履歴スタック）と、当時扱われていなかった問題（保存済みチャネルが他端末で削除されている）を正面から解く。

制約:

- 起動シーケンスは `main.tsx` の `Boot` が `loadUi()` を待ってから描画する。一方チャネル一覧は認証後に TanStack Query が取得するため、**選択チャネルの復元時点ではチャネルが実在するか分からない**。
- 狭幅の画面遷移は `window.history` に積まれ、`seedNarrowHistory()` が起動時に現在の画面で `replaceState` する。履歴 state はリロードをまたいで残るため、起動時の積み直しは必須である。
- 保存データの形式変更は許されるが、旧データを読んでも初期値が壊れてはならない（`pickPersisted` が `undefined` のキーを落とす既存の仕組みで担保される）。

## Goals / Non-Goals

**Goals:**

- 選択中チャネルを端末ごとに保存し、次回起動時に復元する。
- 狭幅では復元したチャネルのタイムラインから起動し、かつ戻る操作でチャネル一覧へ到達できる。
- 保存済みチャネルが存在しない場合に、エラーを出さず選択なしで起動する。
- 現在「永続化しない」ことを検証している単体テストと E2E を、復元する仕様に合わせて反転させる。

**Non-Goals:**

- 選択中チャネルの端末間同期。端末ごとの状態のままとする。
- スレッド（`threadPostId`）やタイムラインのスクロール位置の復元。今回は選択チャネルのみを対象とする。
- バックエンド・API・DB スキーマの変更。
- `desktop-shell` のウィンドウサイズ・位置の扱いの変更（既に Electron 側で別途保存されている）。

## Decisions

### 1. 保存先は既存の `ui` キーへのキー追加とする

`persistedKeys` に `selectedChannelId` を戻すだけとする。新しいストレージキーもマイグレーションも設けない。

- 理由: サイドバー幅・展開状態と同じ「端末ごとの UI 状態」であり、寿命も更新頻度も同じ。分ける利点がない。
- 旧データ（`selectedChannelId` を含まない `ui`）は `pickPersisted` が当該キーを落とすため、初期値 `null` が保たれる。追加のバージョニングは不要。
- 代替案: 専用キー `lastChannel` を新設する案は、読み書きが 2 箇所に増えるだけで得るものがないため採らない。

### 2. `narrowScreen` は復元後に `loadUi` が決める

`loadUi` は `pickPersisted` の適用後、`selectedChannelId` が非 null なら `narrowScreen: 'timeline'` を併せて設定する。`narrowScreen` 自体は従来どおり永続化しない（導出値として扱う）。

- 理由: `selectChannel` が「チャネルを選ぶと `timeline` へ」という対応を既に持っており、復元をその対応に一致させると分岐が増えない。
- 広幅では `narrowScreen` は描画に使われないため、幅で分岐する必要はない。幅の変化時は `AppShell` の `seedNarrowHistory()` が積み直す既存の経路に乗る。
- 代替案: `narrowScreen` も永続化する案は、リロードで幅が変わった場合に矛盾した状態を復元しうるため採らない。

### 3. 起動時の履歴スタックは `channels` を土台にして `timeline` を積む

`seedNarrowHistory()` を、復元後の画面に応じて次のように変える。

- `narrowScreen === 'channels'`: 従来どおり `replaceState({ postallNarrow: 'channels' })` のみ。
- `narrowScreen === 'timeline'`: `replaceState({ postallNarrow: 'channels' })` の後に `pushState({ postallNarrow: 'timeline' })`。

これで復元直後の戻る操作は `channels` の entry に着地し、既存の `watchNarrowHistory` の `popstate` ハンドラが `narrowScreen` を `channels` に戻す。アプリの外へ抜けない。

- 理由: `c0679c8` が回避した問題の直接の原因は「土台となる `channels` entry がないまま `timeline` を表示していた」ことであり、土台を積めば復元をやめる必要がない。
- 起動時に `thread` から始まることはない（`threadPostId` は永続化しない）ため、3 段積む場合を考慮しなくてよい。

### 4. 存在しないチャネルの後始末は、チャネル一覧の取得成功後に一度だけ行う

`AppShell` から呼ぶ専用フック（`useRestoreSelectedChannel` 相当）で、`useChannels()` が **成功** し、かつ `selectedChannelId` が一覧に含まれないときに選択を解除する。

- 取得中・取得失敗（オフライン起動を含む）では解除しない。一時的な失敗で選択を捨てると、復旧後に選び直しが必要になり本変更の目的を損なう。
- 解除は新しいストア操作にまとめる。`selectedChannelId: null`、`narrowScreen: 'channels'` を設定し、狭幅で決定 3 により `timeline` を積んでいた場合（`history.state` が `timeline`）は `history.back()` で積んだ entry を戻す。
- 代替案 A（復元を保留し、チャネル一覧の取得成功まで待ってから `timeline` へ移す）は、正常系でチャネル一覧が一瞬見えてからタイムラインへ飛ぶちらつきを生むため採らない。
- 代替案 B（存在しない旨をトーストで知らせる）は、他端末での削除という日常的な事象に対して過剰であり、仕様でもエラーを出さないと定めたため採らない。

### 5. 選択中チャネルを削除したときの既存経路は変更しない

`ChannelTree` は削除時に、削除対象が選択中なら `selectChannel(null)` を呼ぶ。この経路は保存にもそのまま乗るため、次回起動時も選択なしで開始する。追加の対応は不要。

## Risks / Trade-offs

- **他端末で削除されたチャネルを復元しようとしたとき、解除までの一瞬だけ空のタイムラインが見える** → チャネル一覧の取得は起動直後に走り、解除は成功時に一度だけ行う。空表示は既存の「ポストがない」表示と同じであり、エラーには見えない。
- **決定 4 の `history.back()` が、解除の判定より先にユーザーが画面遷移していた場合に誤って戻る** → `history.state` が `timeline` で、かつ現在の `narrowScreen` が `timeline` のときに限って実行する。スレッドを開いた後などは実行しない。
- **`c0679c8` の判断を戻すことで、当時の別の意図（存在するなら）を取りこぼす** → 当該コミットのメッセージ・差分・関連テストを確認した範囲では、狭幅の戻る操作以外の理由は残されていない。仕様側は 3 箇所とも復元を要求したままであり、仕様に実装を合わせる方向が整合する。
- **端末ごとに開くチャネルが違うことに違和感を持つ可能性** → 端末間同期は Non-Goal とし、仕様にも「同期してはならない」と明記した。将来同期したくなった場合はサーバ側の設定として別変更で扱う。

## Migration Plan

データ移行は不要。旧 `ui` データは `selectedChannelId` を持たないため、初回起動は従来どおり選択なしで始まり、以後の選択から保存が効く。

ロールバックは `persistedKeys` から `selectedChannelId` を外すだけで従来の挙動へ戻る。保存済みの値は読まれなくなるだけで害はない。

## Open Questions

なし。狭幅の起動時の振る舞い（タイムラインを開く）は確認済み。
