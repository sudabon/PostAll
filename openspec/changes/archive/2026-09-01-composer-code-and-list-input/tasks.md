## 1. コードフェンス挿入のカーソル位置

- [x] 1.1 `frontend/src/lib/fence.test.ts` の「inserts a fence and places the cursor after the opening ticks」を、本文の行にカーソルが来る期待値へ書き換える（選択なしで `` ```\n\n``` ``、カーソルは中の空行）
- [x] 1.2 選択ありの単体テストを追加する。選択テキストが開始フェンスの次の行に入り、言語指定の位置に入らないこと
- [x] 1.3 `frontend/src/lib/fence.ts` の `insertCodeFence` を、選択の有無にかかわらず `` ```\n<本文>\n``` `` を組み立てる形へ変える。カーソルは本文の行の先頭に置く
- [x] 1.4 `frontend/src/lib/markdown-format.test.ts:60`「delegates a code block to the shared fence helper」の期待値を更新する。ツールバー経由でも同じ結果になることを確認する

## 2. バッククォート 3 連続の自動展開

- [x] 2.1 `fence.test.ts` に `expandFenceTrigger(prev, next, caret)` のテストを先に書く。展開する場合と、次の各条件で `null` を返す場合をそれぞれ検証する
  - 2 文字以上増えた（貼り付け）
  - 増えた文字がバッククォートでない
  - カーソル直前 3 文字がバッククォート 3 つでない
  - バッククォート 3 つが行頭から始まっていない
  - `isInsideUnclosedFence` が真（未閉フェンスの内側）
- [x] 2.2 `frontend/src/lib/fence.ts` に `expandFenceTrigger` を実装する。展開時は行頭のバッククォート 3 つを取り除いてから `insertCodeFence` を適用し、`{ value, cursor }` を返す
- [x] 2.3 `Composer.tsx` の textarea `onChange` を差し替える。`e.nativeEvent.isComposing` のときは展開せずに `setValue` のみ行う
- [x] 2.4 展開したときは `runFormat` と同じ手順（`requestAnimationFrame` + `setSelectionRange`）でカーソルを本文の行へ置く

## 3. 箇条書きの Tab インデント

- [x] 3.1 `frontend/src/lib/markdown-format.test.ts` に `indentLines` のインデント側テストを先に書く。単一行、複数行選択、箇条書きでない行が混ざる場合（`null` を返す）
- [x] 3.2 数字箇条書きを 1 段階インデントした結果が半角 4 つの字下げになることをテストで固定する。design.md の実測表が根拠
- [x] 3.3 引用（`> `）の行に対して `indentLines` が `null` を返すテストを書く。`anyLineMarker` を流用すると引用が字下げされてしまうため、独立した判定であることをテストで固定する
- [x] 3.4 解除側テストを書く。単一行、複数行選択、**一部だけインデントされた選択（インデント済みの行だけ解除し、インデント 0 の行は据え置き）**、解除できる行が 1 つも無い場合（`null` を返す）
- [x] 3.5 **往復性のテストを書く。** インデント → 解除で元の本文と完全に一致すること。単一行と複数行選択の両方で確認する
- [x] 3.6 `frontend/src/lib/markdown-format.ts` に `indentLines(value, start, end, { outdent })` を実装する。マーカー判定は `- ` `* ` `+ ` `1. ` のみで、引用は含めない（`anyLineMarker` とは別の正規表現にし、意図をコメントで残す）。インデントは対象行が全て箇条書きのときだけ、解除は 1 行でも解除できるときだけ結果を返し、それ以外は `null` を返す
- [x] 3.7 `Composer.tsx` の textarea `onKeyDown` に Tab / Shift+Tab を追加する。`indentLines` が `null` を返したときは `preventDefault()` せず、ブラウザ既定のフォーカス移動に任せる（Shift+Tab は逆方向）
- [x] 3.8 インデントおよび解除の後に選択範囲を保つ（複数行選択が解除されないこと）

## 4. インデント付き行での書式適用

- [x] 4.1 `markdown-format.test.ts` に、インデントされた箇条書き行への `bulletList` / `orderedList` / `quote` 適用のテストを先に書く。インデントが保たれ、マーカーだけが切り替わること
- [x] 4.2 `anyLineMarker` と `applyLinePrefix` を先頭空白の保持に対応させる。マーカー除去・付与・種別切替のいずれでもインデントを落とさない。`anyLineMarker` は引用を含んだままにする（書式操作では引用も剥がす対象であり、`indentLines` の判定とは用途が違う）
- [x] 4.3 インデントの無い既存の挙動が変わっていないことを、既存テストが通ることで確認する

## 5. 結合テストとアクセシビリティの確認

- [x] 5.1 `frontend/src/components/composer/Composer.test.tsx` に、行頭でバッククォートを 3 つ入力すると雛形へ展開されカーソルが本文の行に来る結合テストを追加する
- [x] 5.2 バッククォート 3 つを含むテキストの貼り付けで展開されないことをテストする
- [x] 5.3 箇条書きの行で Tab がインデント、Shift+Tab が解除になり、箇条書きでない行では本文が変わらないことをテストする
- [x] 5.4 空のフォーム・通常の文章・コードブロック内のそれぞれで Tab と Shift+Tab がフォーカスを移すことを確認する（両方向でキーボードトラップが無いこと）
- [x] 5.5 IME を用いた日本語入力中に自動展開が誤発火しないことを実機で確認する

## 6. 仕上げ

- [x] 6.1 design.md の Resolved Questions（自動展開の取り消し手段は用意しない／引用は Tab の対象外）どおりに実装されていることを確認する
- [x] 6.2 `npm run typecheck` / `npm test` / `npm run lint` をすべて通す
- [x] 6.3 `openspec validate composer-code-and-list-input --strict` を通す
