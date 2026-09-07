## 1. ストアの永続化と復元

- [x] 1.1 `frontend/src/state/ui.ts` の `persistedKeys` に `selectedChannelId` を戻し、「永続化しない」旨のコメントを、端末ごとに保存する旨のコメントへ書き換える
- [x] 1.2 `loadUi` に、復元した `selectedChannelId` が非 null のとき `narrowScreen: 'timeline'` を併せて設定する処理を加える（`narrowScreen` 自体は引き続き永続化しない）
- [x] 1.3 保存済みチャネルが存在しなかった場合の後始末用ストア操作を追加する。`selectedChannelId: null` と `narrowScreen: 'channels'` を設定し、狭幅かつ `history.state` が `timeline` かつ現在の `narrowScreen` が `timeline` のときに限り `window.history.back()` を呼ぶ
- [x] 1.4 `frontend/src/state/ui.test.ts` の `does not persist selectedChannelId` と `starts on the channel list with no channel selected` を、保存・復元する仕様に合わせて書き換える（保存されること、復元時に `narrowScreen` が `timeline` になること）
- [x] 1.5 1.3 の後始末操作について、選択が解除され `narrowScreen` が `channels` に戻ることを検証するテストを追加する

## 2. 狭幅の履歴スタック

- [x] 2.1 `frontend/src/state/ui.ts` の `seedNarrowHistory` を、`narrowScreen === 'timeline'` のときに `channels` を `replaceState` してから `timeline` を `pushState` するよう変更する
- [x] 2.2 復元して `timeline` から起動した直後の戻る操作でチャネル一覧へ到達し、履歴から出ないことを検証するテストを `frontend/src/state/ui.test.ts` に追加する
- [x] 2.3 幅の変化で `seedNarrowHistory` が再実行されても履歴が積み増されないことを、既存のテストが担保しているか確認し、足りなければ追加する

## 3. 存在しないチャネルの解除

- [x] 3.1 `useChannels()` の取得成功時にだけ、保存済みの `selectedChannelId` が一覧に含まれるかを判定し、含まれなければ 1.3 の操作を一度だけ呼ぶフックを `frontend/src/hooks/` に追加する（取得中・取得失敗では解除しない）
- [x] 3.2 追加したフックを `frontend/src/components/layout/AppShell.tsx` から呼ぶ
- [x] 3.3 フックの単体テストを追加する。取得成功かつ一覧に無い場合のみ解除し、取得中・取得失敗・一覧にある場合は解除しないことを検証する

## 4. E2E の更新

- [x] 4.1 `frontend/e2e/app.spec.ts` のリロード後の検証（`起動時はチャネル未選択` のコメントと `channel-title` が 0 件である assertion）を、前回のチャネルが復元されている検証へ書き換える
- [x] 4.2 狭幅でチャネルを選択してからリロードし、タイムライン画面から始まること、`narrow-back` でチャネル一覧へ戻れることを検証する E2E を追加する

## 5. 検証

- [x] 5.1 `cd frontend && npm run typecheck` と `npm run lint` が通ることを確認する
- [x] 5.2 `cd frontend && npm run test` が通ることを確認する
- [x] 5.3 `cd frontend && npm run test:e2e` が通ることを確認する
- [x] 5.4 `npm run dev` で広幅・狭幅それぞれリロードし、前回のチャネルが開くこと、狭幅の戻るでチャネル一覧へ戻れることを実際に確認する

## 検証メモ

- 初回実装では型チェック成功、lint は既存の Fast Refresh 警告 6 件のみ。単体テスト 219 件、E2E 27 件が成功。
- E2E の既存スクロールテストは、編集フォームの次フレームの表示位置調整前に座標を記録していたため、フォーム全体が画面内に入るのを待ってから比較するよう修正。
- 5.4 は初回実装時に `VITE_E2E=true npm run dev` と既存 API モックを使った Chromium で、広幅・狭幅の復元と狭幅の戻る操作を画面確認済み。
- 誤操作による削除後、会話に残る実装・テスト・仕様を復元。`mobile/` は復元対象外。
- 復元後の再検証: 型チェック・lint 成功（既存警告 6 件）、単体テスト 245 件・E2E 39 件が成功。
