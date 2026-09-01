# PostAll デザイントークン

`apple-design-ui-modernization` で確定したトークンの正本です。実体は
`frontend/src/index.css`（色・タイポグラフィ・角丸・エレベーション・材質）と
`frontend/src/lib/motion/`（バネ・ジェスチャ定数）にあります。他プラットフォームへ
意匠を展開するときは、この表の値を移植してください。

## 1. 色（oklch）

知覚的な均一性のためすべて `oklch(L C H)` で定義しています。ニュートラルは
暖色寄り（H = 65〜75）、アクセントは既存の青（H = 261）を維持しています。

| トークン | ライト | ダーク |
| --- | --- | --- |
| `--background` | `oklch(0.985 0.006 70)` | `oklch(0.17 0.012 65)` |
| `--foreground` | `oklch(0.2 0.015 65)` | `oklch(0.94 0.008 75)` |
| `--card` | `oklch(0.995 0.003 75)` | `oklch(0.205 0.014 65)` |
| `--popover` | `oklch(0.995 0.003 75)` | `oklch(0.225 0.016 65)` |
| `--primary` | `oklch(0.56 0.2 261)` | `oklch(0.56 0.2 261)` |
| `--primary-foreground` | `oklch(0.99 0.004 75)` | `oklch(0.99 0.004 75)` |
| `--secondary` | `oklch(0.94 0.012 70)` | `oklch(0.27 0.016 65)` |
| `--secondary-foreground` | `oklch(0.26 0.018 65)` | `oklch(0.92 0.008 75)` |
| `--muted` | `oklch(0.95 0.01 70)` | `oklch(0.255 0.014 65)` |
| `--muted-foreground` | `oklch(0.48 0.018 65)` | `oklch(0.72 0.015 70)` |
| `--disabled-foreground` | `oklch(0.55 0.014 65)` | `oklch(0.62 0.012 70)` |
| `--accent` | `oklch(0.925 0.018 70)` | `oklch(0.3 0.025 65)` |
| `--accent-foreground` | `oklch(0.24 0.018 65)` | `oklch(0.95 0.008 75)` |
| `--destructive` | `oklch(0.56 0.205 25)` | `oklch(0.56 0.205 25)` |
| `--success` | `oklch(0.5 0.14 145)` | `oklch(0.67 0.15 145)` |
| `--warning` | `oklch(0.72 0.16 70)` | `oklch(0.78 0.15 80)` |
| `--info` | `oklch(0.56 0.2 261)` | `oklch(0.56 0.2 261)` |
| `--border` / `--input` | `oklch(0.64 0.02 65)` | `oklch(0.49 0.02 65)` |
| `--ring` | `oklch(0.56 0.2 261)` | `oklch(0.56 0.2 261)` |

チャート系は `--chart-1`〜`--chart-5` として同ファイルに定義しています。

## 2. タイポグラフィ（サイズ / 行間 / 字間の三つ組）

段が大きいほど字間を負に、行間を狭くします。本文の字間は 0 です。

| 段 | サイズ | 行間 | 字間 |
| --- | --- | --- | --- |
| `caption` | 0.75rem (12px) | 1.45 | `0.012em` |
| `body` | 0.875rem (14px) | 1.55 | `0em` |
| `title` | 1rem (16px) | 1.35 | `-0.01em` |
| `heading` | 1.25rem (20px) | 1.2 | `-0.018em` |
| `display` | 1.5rem (24px) | 1.1 | `-0.026em` |

ヘッダー中央のブランド表記のみ `--font-script`（`Snell Roundhand` → `Apple Chancery` → `Segoe Script` → `Brush Script MT` → `cursive`）を使い、Tailwind の `font-script` から参照します。

## 3. 角丸

基準は `--radius: 0.75rem`（12px）で、そこからの相対で刻みます。

| トークン | 値 |
| --- | --- |
| `--radius-sm` | `calc(var(--radius) - 4px)` = 8px |
| `--radius-md` | `calc(var(--radius) - 2px)` = 10px |
| `--radius-lg` | `var(--radius)` = 12px |
| `--radius-xl` | `calc(var(--radius) + 4px)` = 16px |
| `--radius-2xl` | `calc(var(--radius) + 8px)` = 20px |

## 4. エレベーション

| トークン | ライト | ダーク |
| --- | --- | --- |
| `--elevation-sm` | `0 1px 2px oklch(0.2 0.015 65 / 0.08), 0 1px 1px oklch(0.2 0.015 65 / 0.04)` | `0 1px 2px oklch(0.05 0.01 65 / 0.28), 0 1px 1px oklch(0.05 0.01 65 / 0.18)` |
| `--elevation-md` | `0 8px 24px -10px oklch(0.2 0.015 65 / 0.22), 0 2px 8px -4px oklch(0.2 0.015 65 / 0.12)` | `0 10px 28px -10px oklch(0.05 0.01 65 / 0.58), 0 3px 10px -4px oklch(0.05 0.01 65 / 0.36)` |
| `--elevation-lg` | `0 24px 64px -24px oklch(0.2 0.015 65 / 0.34), 0 8px 24px -12px oklch(0.2 0.015 65 / 0.18)` | `0 28px 72px -24px oklch(0.05 0.01 65 / 0.72), 0 10px 28px -12px oklch(0.05 0.01 65 / 0.48)` |

## 5. 材質（半透明レイヤー）

背景色とぼかしの組で「厚み」を表します。`thin` はヘッダー、`regular` は
コンテンツが背後に潜り込んだときのヘッダーとスレッドパネル、`thick` は
サイドバーとモーダル面に使います。

| トークン | ライト | ダーク | フィルタ |
| --- | --- | --- | --- |
| `--material-thin` | `oklch(0.995 0.004 75 / 0.7)` | `oklch(0.23 0.016 65 / 0.68)` | `blur(14px) saturate(1.35)` |
| `--material-regular` | `oklch(0.99 0.006 70 / 0.82)` | `oklch(0.215 0.016 65 / 0.8)` | `blur(22px) saturate(1.45)` |
| `--material-thick` | `oklch(0.975 0.008 70 / 0.92)` | `oklch(0.195 0.014 65 / 0.92)` | `blur(32px) saturate(1.55)` |
| `--material-edge` | `oklch(0.995 0.004 75 / 0.88)` | `oklch(0.28 0.018 65 / 0.9)` | — |

### アクセシビリティ設定での差し替え

- `prefers-reduced-transparency: reduce` — 3 段のフィルタをすべて `none` にし、
  背景の不透明度を 0.98〜1.0 まで引き上げます。
- `prefers-contrast: more` — 上記に加えて `--border` / `--input` を
  ライト `oklch(0.5 0.025 65)` / ダーク `oklch(0.68 0.02 70)` へ引き締めます。
- `forced-colors: active` — 材質は `Canvas`、境界は `CanvasText`、
  フォーカスリングは `Highlight` に落とします。

テーマ切り替えは `--theme-transition-duration: 180ms` の
`background-color` / `color` トランジションで繋ぎます。

## 6. モーション

### バネプリセット（`frontend/src/lib/motion/springs.ts`）

| プリセット | bounce | duration | 用途 |
| --- | --- | --- | --- |
| `snap` | 0 | 0.35s | 既定。押下・ホバー・オーバーレイの出入り・サイドバーの開閉 |
| `sheet` | 0.2 | 0.3s | 併置パネルとバナーの出入り |
| `momentum` | 0.2 | 0.4s | ドラッグ解放後の着地（解放速度を `velocity` として引き継ぐ） |

`prefers-reduced-motion: reduce` のときは、移動・拡大を伴う演出を
`{ duration: 0.14, ease: 'easeOut' }` の不透明度クロスフェードへ差し替えます。
押下・完了・エラーのフィードバックは残します。

### ジェスチャ定数（`frontend/src/lib/motion/gesture.ts`）

| 定数 | 値 | 意味 |
| --- | --- | --- |
| 速度サンプル窓 | 120ms / 直近 5 点 | 解放速度の算出範囲 |
| 減衰率 `d` | 0.998 | 停止位置の予測 `current + (v/1000) * d / (1 - d)` |
| ラバーバンド係数 `c` | 0.55 | 境界超過 `overshoot * dim * c / (dim + c * |overshoot|)` |
| ヒットパディング | 10px | `usePressable()` が押下を維持する範囲の余白 |

押下フィードバックは pointer-down の時点で `data-pressed` を立て、
範囲外への離脱で解除、範囲内への復帰で再度立て、pointer-up で確定します。

## 7. 検証記録（2026-08-28）

Chromium（Playwright / Desktop Chrome）と Electron 実機で計測した結果です。

- **低モーション**: 検索ダイアログ 34 フレーム、スレッドパネル 30 フレームを
  サンプリングし、いずれも `transform: none`。不透明度のみ 0.16 → 1.0 で推移。
  押下フィードバックと投稿完了表示は維持。
- **低透明度**: サイドバー `blur(32px) saturate(1.55)` / α0.92 → `none` / α1.0、
  ヘッダー `blur(14px) saturate(1.35)` / α0.7 → `none` / α0.98。
- **高コントラスト**: 材質は不透明化し、`--border` が
  `oklch(0.64 0.02 65)` → `oklch(0.5 0.025 65)` へ。
- **テーマ切り替え**: `0.18s` のトランジションで両方向とも 12 段階の中間フレームを
  観測。全フレームがライト（L=0.985）とダーク（L=0.17）の間に収まり、明滅なし。
- **長いタイムライン**: 400 ポスト描画で 2.5 秒スクロールし、平均 16.67ms /
  p95 17.5ms / 33ms 超のフレーム 0 件。`backdrop-filter` を無効化した比較でも
  平均 16.67ms で、材質レイヤーによる追加コストは計測できず。
- **Electron 並行性**: Electron シェルと同一の production バンドルをブラウザで
  開いた場合とで、色・角丸・材質・エレベーション・本文タイポグラフィの
  計算値が完全一致。
- **バンドルサイズ**: エントリチャンクは 746,057 B → 846,593 B（gzip 218,352 B →
  251,260 B、+32.1KB / +15.1%）、CSS は 25,898 B → 34,945 B（gzip +1,075 B）、
  `dist` 全体は 14,274,808 B → 14,384,391 B（+0.77%）。`motion` は
  `LazyMotion` + `domAnimation`（最小機能セット）で読み込んでおり、
  この増分は許容範囲としてオーバーレイの動的インポートは見送りました。
