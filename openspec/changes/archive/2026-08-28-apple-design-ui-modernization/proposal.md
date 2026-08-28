## Why

現在の UI は shadcn/ui の既定 slate テーマをほぼ素のまま使っており、色・タイポグラフィ・余白・境界線がすべて「初期設定のまま」に見える状態です。加えて画面全体で動きの設計が存在せず（`transition-colors` と `opacity` が数箇所あるのみ）、押下フィードバック・オーバーレイの出入り・サイドバーのドラッグはいずれも即時切り替えか等速の CSS トランジションで、操作に対する手応えがありません。日々の記録用途で長時間触るアプリとして、見た目の質と操作感の両方が製品の水準に届いていないため、Apple のインターフェース設計原則（流体的な操作感・材質による階層表現・光学的なタイポグラフィ）に沿って刷新します。

## What Changes

- **デザイントークンの再定義**: 色・タイポグラフィスケール・余白・角丸・エレベーション（影）・材質（半透明レイヤー）を一貫したトークン体系として `frontend/src/index.css` に定義し直します。文字サイズごとにトラッキング（字間）とリーディング（行間）を持たせ、既定の slate パレットから脱却します。
- **モーションシステムの導入**: バネ（spring）ベースのモーション基盤を導入し、既定は臨界減衰（オーバーシュートなし）、勢いを伴う操作のみ弱いバウンスという方針を全画面に適用します。すべてのアニメーションは中断可能とし、現在の表示値から再開します。
- **押下フィードバックの即時化**: ボタン・チャネル行・リアクション・ポストのアクションを、クリック（pointer-up）ではなく pointer-down の瞬間に反応させます。
- **オーバーレイの刷新**: 検索ダイアログ・設定ダイアログ・絵文字ピッカー・スレッドパネルを、出現元にアンカーされた対称な出入り（入った経路と同じ経路で退出）と、材質としての立ち上がり（blur とスケールの同時アニメーション）に置き換えます。
- **クロームの材質化**: ヘッダーとサイドバーを半透明の浮遊レイヤー（`backdrop-filter`）とし、コンテンツがその下をスクロールする構成にします。ヘッダー下の 1px ボーダーは、重なりが生じる箇所のみのスクロールエッジ効果に置き換えます。
- **サイドバーのドラッグ改善**: ポインタキャプチャによる 1:1 追従、最小・最大幅でのラバーバンディング（ハードストップの廃止）、離した時点の速度を引き継ぐ着地に変更します。
- **アクセシビリティ設定への追従**: `prefers-reduced-motion` / `prefers-reduced-transparency` / `prefers-contrast` に応じて、モーションをクロスフェードへ、半透明を不透明へ、境界を高コントラストへ切り替えます。
- **未整備コンポーネントの整理**: `AppShell` のヘッダーにある素の `<button>`（「折りたたむ」等）を含め、共通コンポーネント経由に統一します。
- 対象は Web フロントエンド（`frontend/`）と、それを同梱する Electron シェルです。Flutter 製のモバイルアプリ（`mobile/`）は本変更のスコープ外です。
- バックエンド API、データモデル、認証フローへの変更はありません。

## Capabilities

### New Capabilities
- `visual-design-system`: 色・タイポグラフィ・余白・角丸・エレベーション・材質のトークン体系と、ライト/ダークおよびアクセシビリティ設定（低モーション・低透明度・高コントラスト）への追従を定義します。
- `fluid-interactions`: バネベースのモーション、中断可能性、1:1 の直接操作、速度の引き継ぎ、勢いの投影、ラバーバンディング、押下フィードバックのタイミングなど、操作感に関する振る舞いを定義します。

### Modified Capabilities
- `desktop-shell`: 3ペインレイアウトの要件を、不透明な固定ヘッダー前提から、コンテンツがその下を流れる半透明の浮遊クローム前提に変更します。またサイドバー幅変更の要件に、境界でのラバーバンディングと離した後の減速着地を追加します。

## Impact

- **コード**: `frontend/src/index.css`（トークン定義の全面刷新）、`frontend/src/components/ui/button.tsx`、`frontend/src/components/layout/AppShell.tsx`、`frontend/src/components/channels/ChannelTree.tsx`、`frontend/src/components/timeline/Timeline.tsx`、`frontend/src/components/composer/Composer.tsx`、`frontend/src/components/thread/ThreadPanel.tsx`、`frontend/src/components/search/SearchDialog.tsx`、`frontend/src/components/settings/SettingsDialog.tsx`、`frontend/src/components/reactions/*`、`frontend/src/components/post/PostActions.tsx`、`frontend/src/components/pwa/UpdateBanner.tsx`、`frontend/src/components/auth/SignInScreen.tsx`。加えてモーション用の共有ユーティリティを新規追加します。
- **依存関係**: バネアニメーション用ライブラリ（`motion`）を `frontend` に追加します。バンドルサイズの増加は design.md で評価します。
- **テスト**: 既存の Vitest コンポーネントテストと Playwright E2E は、DOM 構造やクラス名の変更により更新が必要になる可能性があります。`data-testid` は維持します。
- **API・データ**: 変更なし。
- **他プラットフォーム**: Electron シェルは同じフロントエンド成果物を同梱するため自動的に追従します。Flutter モバイルアプリは対象外で、意匠が一時的に乖離します。
