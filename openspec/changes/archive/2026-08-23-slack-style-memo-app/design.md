## Context

PostAll はリポジトリに README しか存在しない状態から始まる。本 change は「Slack 風のポスト型メモ管理」を、macOS デスクトップ・ブラウザ・iOS の 3 経路で成立させるための最初の骨格を作る。

確定している制約は以下。

| 領域 | 決定 |
|---|---|
| バックエンド | Go |
| データベース | PostgreSQL（`pg_bigm` 拡張による全文検索） |
| 実行環境 | インターネット上のコンテナサーバ（Nginx / Certbot / API / PostgreSQL をコンテナ配備） |
| 認証 | AWS Cognito ユーザープール |
| ファイルストレージ | Amazon S3 |
| デスクトップ / Web | React + TypeScript + Vite + TailwindCSS + shadcn/ui → Electron と PWA の 2 経路で配布 |
| モバイル | Flutter（iOS のみ） |
| 動作前提 | オンライン（オフライン編集は非対応） |

この構成は「Web 技術のクライアント 2 経路（Electron / PWA）」と「非 Web のクライアント（Flutter iOS）」が同じ API を共有することを意味する。したがって **API 契約とデータモデルが本設計の中心**であり、UI 実装の詳細より先にそこを固める。

Electron と PWA が同一の React コードから出る以上、**Electron でしか使えない機能（アプリメニュー、グローバルショートカット、ネイティブファイルダイアログ、OS 通知）をコンポーネントから直接呼んではならない**。この境界を最初に引かないと、後から PWA を足すときに全画面を触ることになる。

また、チャネルの drag & drop による階層編集は、UI の操作性だけでなく「階層と並び順をどうデータとして持つか」に直結する。ここを後から変えるとデータ移行が発生するため、本設計で決め切る。

## Goals / Non-Goals

**Goals:**

- Go バックエンド、React フロントエンド（Electron + PWA）、Flutter iOS を含むモノレポの構成と境界を定める。
- チャネル階層（親子 + 兄弟の並び順）を、drag & drop の 1 操作が安価に反映されるデータモデルで表現する。
- 「古い順」タイムラインを、初期 10 件・上方向への動的取得という形で、ポスト数が増えても破綻しない読み込み方式で成立させる。
- 3 クライアントが型のズレなく同じ API を使うための、単一の API 契約定義を置く。
- Electron 固有機能を抽象化し、同一コードから PWA を出せる境界を定める。
- Markdown / シンタックスハイライト / Mermaid を、React と Flutter の双方で同等に見せる方針を決める。
- Cognito による認証を全クライアント・全 API に一貫して適用する。
- スレッド返信と絵文字リアクションを、タイムラインの読み込み方式を壊さない形でデータモデルに組み込む。
- 実装を段階に分け、各段階の終わりに動作を確認できる順序を定める。

**Non-Goals:**

- オフラインでの編集・投稿キュー・競合解決（オンライン前提のため。閲覧中の接続断に対する体験の劣化緩和のみ扱う）。
- 複数ユーザーでの共同利用を前提とした権限モデル（Cognito で認証はするが、個人利用のため所有者は 1 人とみなす）。
- メンション、通知、既読管理。
- チャネルのアーカイブ（「ポストを持つチャネルは削除禁止」の代替として将来必要になるが、本 change では扱わない）。
- Windows / Linux デスクトップ、Android 対応。
- 編集履歴・版管理（編集は上書き）。

## Decisions

### D1. リポジトリ構成はモノレポ

```
PostAll/
├── api/                    # OpenAPI 仕様（単一の API 契約）
├── backend/                # Go: HTTP API + PostgreSQL + S3 + Cognito 検証
│   ├── cmd/postall-server/
│   ├── internal/{http,auth,service,store,blob,search,emoji}/
│   └── migrations/
├── frontend/               # React + TS + Vite + Tailwind + shadcn/ui（Electron と PWA の共通コード）
│   └── src/platform/       # プラットフォームアダプタ（D3）
├── electron/               # Electron メインプロセス・パッケージング
├── mobile/                 # Flutter（iOS）
├── emoji/                  # カスタム絵文字の png（D9）
├── infra/                  # コンテナ定義（compose）、Nginx 設定、Certbot 設定
└── openspec/
```

**理由**: API 契約とデータモデルを 3 クライアントが共有するため、別リポジトリに分けると契約変更のたびに複数 PR の同期が必要になる。単一リポジトリなら「スキーマ変更 → 生成コード更新 → 3 クライアント修正」が 1 コミットに収まる。

### D2. API 契約は OpenAPI を single source of truth とし、各言語のコードを生成する

- 仕様: `api/openapi.yaml`
- Go: `oapi-codegen` でサーバのインターフェースと型を生成
- TypeScript: `openapi-typescript` で型を生成し、fetch クライアントを薄く手書き
- Dart: OpenAPI から型とクライアントを生成

**理由**: 型を持つクライアントが 3 つある構成で、手書きの型定義を複数箇所に置くと必ずズレる。ズレは実行時エラーとしてしか現れず、しかも片方のプラットフォームでしか再現しないため発見が遅れる。

**代替案**: gRPC。型安全性はさらに高いが、ブラウザからの利用にプロキシが要り、添付のアップロードが素直に書けない。HTTP + JSON で足りる規模なので採らない。

**トレードオフ**: 仕様の更新漏れを防ぐため、CI で生成を実行し差分が出たら失敗させる（生成 → `git diff --exit-code`）。

### D3. Electron と PWA は同一ビルドを共有し、プラットフォーム差はアダプタ層で吸収する

`frontend/` は Electron と PWA の**両方で動く 1 つの React アプリ**とする。Electron はそのビルド成果物をローカルバンドルとして同梱し、PWA は同じ成果物をサーバから配信する。

プラットフォーム依存の機能は `frontend/src/platform/` のインターフェース越しにのみ呼ぶ。

| 能力 | Electron 実装 | PWA 実装 |
|---|---|---|
| アプリメニュー | ネイティブメニュー（IPC） | アプリ内メニューバー UI |
| グローバルショートカット | `globalShortcut` | ウィンドウ内キーハンドラのみ |
| ファイル保存ダイアログ | `dialog.showSaveDialog` | `<a download>` / File System Access API |
| ファイル選択 | ネイティブダイアログ | `<input type="file">` |
| 通知 | Electron `Notification` | Web Notifications API |
| ウィンドウ状態の保存 | メインプロセスで永続化 | `localStorage` |

**理由**: UI コンポーネントが `window.electron` を直接触ると、PWA ビルドで実行時に落ちる。落ちる場所がコンポーネント内部だと、PWA 対応は全画面の改修になる。アダプタを 1 箇所に閉じ込めれば、PWA 対応は「アダプタのブラウザ実装を書く」だけで済む。

**トレードオフ**: 能力差をアダプタが吸収しきれない場面（グローバルショートカットは PWA に存在しない）では、**機能を消すのではなく劣化させる**。アダプタは「その能力が使えるか」を返し、UI は使えない場合に該当の導線を隠す。

**Mermaid / Shiki の描画**: Electron も PWA も Chromium 系エンジンであるため、初期設計で懸念していた WebView 差異の問題は発生しない。

### D4. バックエンドはインターネット上のコンテナサーバで稼働し、全クライアントはオンライン前提

- **Nginx / Certbot / API サーバ / PostgreSQL の 4 つをコンテナとして同一ホストに配備する。**
- **Nginx を TLS 終端かつ唯一の公開エンドポイントとし、API サーバと PostgreSQL はインターネットへ直接公開しない。**
- クライアント（Electron / PWA / iOS）はいずれも Nginx の同一エンドポイントへ接続する。
- **オフラインでの編集・投稿は行わない。** 接続できない場合は、その旨を示して操作を止める。

**理由**: 3 クライアントが同じデータを見る要件を最も単純に満たす。オフライン対応は競合解決という別種の複雑さを持ち込むため、必要になった時点で後続 change として扱う。

**接続断時の体験**: 「オフラインで編集できる」ことは要求しないが、**入力中の内容を失わせない**ことは要求する。送信に失敗したポストはフォームに戻し、下書きとして保持する。

### D5. 認証は Cognito ユーザープール、バックエンドは JWT をローカル検証する

- サインインは Cognito の認可コードフロー（PKCE）。
- クライアントは取得したトークンを `Authorization: Bearer` で送る。
- バックエンドは Cognito の JWKS を取得・キャッシュし、**署名・発行者・オーディエンス・有効期限をローカルで検証する**。要求ごとに Cognito へ問い合わせない。
- アプリ内のユーザー識別子は Cognito の `sub`。`users` テーブルに `cognito_sub` を持ち、初回サインイン時に行を作る。

**理由**: 検証をローカルで行えば、Cognito への往復がリクエストのレイテンシに乗らず、Cognito の障害がそのまま API の停止にならない。JWKS のキャッシュは鍵ローテーションに追随できるよう TTL を持たせる。

**トークンの保管**: Electron は OS のセーフストレージ、PWA はメモリ + リフレッシュトークンを `httpOnly` Cookie に寄せる方針を優先し、`localStorage` への保存は避ける。iOS は Keychain。

**認証 UI とリダイレクト URI（確定）**: Cognito Hosted UI を使う。各クライアントのリダイレクト URI は D20 を参照。

### D6. チャネル階層は隣接リスト + fractional index

```sql
channels(
  id          uuid primary key,
  parent_id   uuid null references channels(id),
  name        text not null,
  sort_key    text not null,          -- 兄弟内の順序（fractional index）
  created_at  timestamptz not null,
  updated_at  timestamptz not null
)

-- 同一階層での同名を禁止する（parent_id が NULL の行は UNIQUE で重複扱いされないため索引を分ける）
create unique index channels_name_in_parent
  on channels (parent_id, name) where parent_id is not null;
create unique index channels_name_at_root
  on channels (name) where parent_id is null;
```

- 親子関係は `parent_id`（隣接リスト）。祖先・子孫の取得は `WITH RECURSIVE`。
- **階層の深さに上限を設けない。**
- 兄弟内の順序は整数連番ではなく、辞書順で比較可能な文字列 `sort_key`（fractional index）で持つ。

**理由**: drag & drop は「2 要素の間に落とす」操作である。整数 position だと 1 回の移動で兄弟全件の再採番が発生し、更新行数が増える。fractional index なら「前後のキーの中間値を生成して 1 行だけ更新」で済み、drag & drop の 1 操作が 1 行の UPDATE に落ちる。

**同名禁止の実装**: `parent_id` が NULL の行同士は UNIQUE 制約で重複と見なされないため、ルート直下とそれ以外で部分ユニーク索引を分ける。この落とし穴は実装時に必ず踏むため、設計で明示しておく。

**削除の制約**: **ポストを 1 件でも持つチャネルは削除できない。** 子チャネルを持つ場合も、子孫のいずれかがポストを持つなら削除できない。削除可否の判定は再帰 CTE で子孫のポスト有無を数える。将来のアーカイブ機能はこの制約の逃げ道として想定するが、本 change では実装しない（Open Questions Q13）。

**代替案**: Closure table / materialized path。深い階層の子孫クエリが速いが、チャネル数はたかだか数百のオーダーであり、移動時の書き込み量が増える方が痛い。

### D7. ポストは keyset pagination、初期 10 件、論理削除

```sql
posts(
  id             uuid primary key,
  channel_id     uuid not null references channels(id),
  thread_root_id uuid null references posts(id),   -- NULL ならチャネル直下のポスト（D8）
  author_id      uuid not null references users(id),
  body           text not null,
  created_at     timestamptz not null,
  updated_at     timestamptz not null,
  edited_at      timestamptz null,                 -- 編集済み表示のためだけに使う
  deleted_at     timestamptz null                  -- 論理削除
)
create index on posts (channel_id, created_at, id) where thread_root_id is null and deleted_at is null;
create index on posts (thread_root_id, created_at, id) where deleted_at is null;
```

- カーソルは `(created_at, id)` の組。OFFSET は使わない。
- **チャネルを開いた直後に読むのは最新 10 件**であり、それを昇順に並べ替えて描画する。上へスクロールすると、さらに古い側を追加取得する。
- **編集履歴は保持しない。** 本文は上書きし、`edited_at` を「編集済み」表示のためだけに記録する。
- **削除は論理削除**（`deleted_at`）。全クエリは `deleted_at is null` で絞る。

**理由**: OFFSET はポスト数に比例して遅くなり、読み込み中に新規ポストが入ると行がずれる。keyset なら両方を避けられる。論理削除は誤削除からの復旧余地を残し、スレッド返信を持つポストが消えたときの親子関係の破綻も防ぐ。

**削除済みの表示（確定）**: タイムラインからは完全に隠す。スレッド内の扱いは D23 を参照。

### D8. スレッド返信は同一テーブルの自己参照で表現する

- 返信は `posts` の行として作り、`thread_root_id` に親ポストの id を入れる。
- **チャネルのタイムラインは `thread_root_id is null` の行のみを返す。** 返信がタイムラインに混ざらないことを、索引の WHERE 句レベルで保証する。
- 親ポストには返信件数と最終返信日時を表示する。集計は返信数が小さい前提でクエリ時に求め、性能が問題になった時点で非正規化する。
- **返信の返信（多段スレッド）は作らない。** `thread_root_id` を持つポストへの返信は、同じ `thread_root_id` を継承する。

**理由**: 別テーブルにすると、本文・添付・リアクション・論理削除の扱いをすべて二重に実装することになる。同一テーブルなら、これらの機能が返信にも自動的に適用される。多段スレッドを禁じるのは、木構造の表示と読み込みが一気に複雑化する割に、メモ用途での必要性が薄いため。

### D9. 絵文字は `emoji/` ディレクトリの png をカタログへ登録して使う

```sql
emojis(
  id           uuid primary key,
  shortcode    text not null unique,   -- ファイル名から導出（例: shipit.png -> :shipit:）
  storage_key  text not null,          -- 配信元のキー
  checksum     text not null,          -- 同一ファイルの再登録を検出する
  created_at   timestamptz not null
)

reactions(
  post_id    uuid not null references posts(id),
  emoji_id   uuid not null references emojis(id),
  user_id    uuid not null references users(id),
  created_at timestamptz not null,
  primary key (post_id, emoji_id, user_id)
)
```

- `emoji/` に置かれた png のファイル名（拡張子を除いた部分）がショートコードになる。
- 登録処理はディレクトリを走査し、未登録またはチェックサムが変わったものをカタログへ反映する。
- 同一ユーザーが同一ポストへ同じ絵文字を二重に付けられないことを、主キーで保証する。

**理由**: 主キーの構成そのものが「1 ユーザー 1 ポスト 1 絵文字につき 1 件」という規則を表す。アプリケーション側の重複チェックは競合状態で破れるが、主キーは破れない。

**登録と配信（確定）**: 管理コマンドによる走査、カスタム png のみ、API からの静的配信。詳細は D25。

### D10. Markdown 描画は「共通の意味論、プラットフォーム別の実装」。Mermaid は投稿確定時のみ描画する

- **React 側**: `react-markdown` + `remark-gfm` + `rehype-sanitize`。ハイライトは Shiki。Mermaid は動的 import し、描画失敗時はコードブロックへフォールバック。
- **Flutter 側**: Markdown 描画とコードハイライトは Flutter パッケージ。**Mermaid のみ WebView（`webview_flutter`）に `mermaid.js` を載せて描画する。**
- **入力中のライブプレビューは行わない。** Mermaid の描画は投稿が確定したポストに対してのみ実行する。

**Mermaid を Flutter で WebView に載せる理由**: Mermaid には Dart 実装が存在せず、記法も継続的に拡張される。自前実装は追随コストが青天井になる。WebView に本家 JS を載せれば、React 側と同じバージョンの同じレンダラを使えるため、「同じ図が両方で同じに見える」が実装ではなく構成として保証される。

**ライブプレビューを行わない理由**: 入力のたびに描画すると、デバウンス、構文エラー中の表示、描画コストの制御という 3 つの問題が同時に発生する。メモアプリでの投資対効果が見合わない。

**トレードオフ**: WebView はポストごとに生成すると重い。Mermaid を含むポストは可視領域に入ったときだけ描画し、1 タイムラインあたりの同時 WebView 数に上限を設ける。

### D11. 添付は S3 へ署名付き URL で直接やり取りし、DB にはメタデータのみ置く

```sql
attachments(
  id           uuid primary key,
  post_id      uuid null references posts(id),  -- コミット前は NULL
  file_name    text not null,
  content_type text not null,
  size_bytes   bigint not null,
  storage_key  text not null,
  checksum     text not null,
  created_at   timestamptz not null
)
```

1. クライアントがアップロード開始を API へ要求し、**署名付き PUT URL** を受け取る。この時点でサイズ・MIME type の制約をサーバが検査する。
2. クライアントは S3 へ直接アップロードする。
3. 完了を API へ通知し、メタデータをポストに紐付けてコミットする。
4. ダウンロードは、認可を検査したうえで**短期の署名付き GET URL** を発行する。

**理由**: 添付の実体をバックエンド経由で流すと、コンテナの帯域とメモリが画像に食われる。S3 へ直接やり取りすれば、バックエンドは認可と署名の発行だけを担う。

**認可**: 署名付き URL は推測不可能かつ短期であり、発行時にバックエンドが認可を検査する。バケットはパブリック読み取りを禁止する。

**回収**: コミットされなかった添付（`post_id is null` のまま一定時間経過）と、論理削除されたポストの添付は回収ジョブで削除する。孤児は容量を食うだけで、参照切れより害が小さいため、削除は遅延させてよい。

### D12. 全文検索は `pg_bigm`

```sql
create extension pg_bigm;
create index posts_body_bigm on posts using gin (body gin_bigm_ops);
```

- 検索は `body LIKE '%語%'` を bigram 索引で実行する。
- チャネルによる絞り込み、投稿日時の範囲指定を併用できるようにする。

**理由**: PostgreSQL 標準の `to_tsvector` による全文検索は、日本語では形態素解析辞書（`pg_bigm` 以外なら `pgroonga` や `textsearch_ja`）が必要になる。`pg_bigm` は 2-gram で索引するため辞書が不要で、**分かち書きに失敗して検索漏れが起きるという日本語特有の問題を回避できる**。

**トレードオフ**: 1 文字での検索は索引が効かず全件走査になる。UI 側で最小検索文字数を 2 文字とする。索引サイズは本文量に対して大きめになる。

**重大な前提**: **`pg_bigm` は Amazon RDS for PostgreSQL では利用できるが、Aurora PostgreSQL では提供されていない。** 自前コンテナで PostgreSQL を動かす場合は `pg_bigm` を含むイメージをビルドする必要がある。この確認を M0 の最初に行う（→ Open Questions Q1、Risks）。

### D13. サーバからの変更通知は SSE

**理由**: 必要なのはサーバ → クライアントの一方向通知だけで、クライアント → サーバは通常の HTTP POST で足りる。SSE は HTTP のままで、再接続とイベント ID による取りこぼし補完（`Last-Event-ID`）が仕様として備わっている。

**代替案**: WebSocket（双方向が要る場面が無い割に接続管理の手間が増える）、定期ポーリング（遅延と無駄な負荷が常時かかる）。

**トレードオフ**: iOS ではバックグラウンド時に接続が切れる。復帰時は「切断中の差分をまとめて取得する」フォールバックを必ず用意し、SSE を唯一の同期手段にしない。

### D14. クライアントの状態管理

- **React**: サーバ状態は TanStack Query（キャッシュ、再取得、楽観的更新とロールバックの枠組みが要件にそのまま対応する）。UI 状態（サイドバー幅、展開状態、下書き）は Zustand + プラットフォームアダプタ経由の永続化。
- **Flutter**: Riverpod。

**理由**: 「楽観的更新 → 失敗したら巻き戻す」は投稿・階層移動・リアクションの複数箇所に現れる横断的な関心事であり、各画面で手書きすると必ず抜けが出る。ライブラリの提供する枠組みに寄せる。

### D15. Go バックエンドの内部構造は 3 層

`internal/http`（ハンドラ・入出力変換）→ `internal/service`（業務規則・トランザクション境界）→ `internal/store`（PostgreSQL アクセス）。認証は `internal/auth`（JWT 検証ミドルウェア）、S3 は `internal/blob`、検索は `internal/search` に分ける。

- DB アクセスは `pgx` + `sqlc`。ORM は使わない。
- マイグレーションは版管理されたファイルをバイナリに埋め込み、起動時に未適用分を検出する。
- 階層移動のような複数行更新はサービス層でトランザクション境界を張る。

**理由**: 再帰 CTE、fractional index の比較、bigram 索引を使う LIKE 検索など、この設計は SQL を直接書きたい箇所が多い。ORM の抽象を挟むと、生成される SQL を確認するために結局 SQL を読むことになる。sqlc は「SQL を書いて型を得る」ため、この性質に合う。

### D16. テスト方針

- **Go**: サービス層とストア層は testcontainers で立てた実 PostgreSQL（`pg_bigm` 入り）に対して統合テストを書く。SQLite やモックで代用しない（再帰 CTE・部分ユニーク索引・bigram 検索は PostgreSQL の挙動そのものが検証対象のため）。
- **React**: Vitest + Testing Library、Playwright で主要導線。プラットフォームアダプタはテスト用のフェイク実装を用意し、Electron と PWA の両方の分岐を検証する。
- **Flutter**: widget test と `integration_test`。
- 各 spec の Scenario が、いずれかの層のテストケースに対応することを実装時の完了条件とする。

### D17. Nginx を唯一の公開エンドポイントとし、Certbot で証明書を自動更新する

構成は 4 コンテナ。Nginx が 443 を受け、パスによって振り分ける。

| コンテナ | 役割 |
|---|---|
| `nginx` | TLS 終端、API へのリバースプロキシ、PWA 静的アセットの配信、HTTP → HTTPS リダイレクト |
| `certbot` | Let's Encrypt 証明書の取得と自動更新 |
| `api` | Go の API サーバ（外部へ直接公開しない） |
| `postgres` | PostgreSQL（`pg_bigm` 入り、外部へ直接公開しない） |

証明書とその検証用ディレクトリ、および PostgreSQL のデータは、コンテナのライフサイクルから独立したボリュームに置く。

**理由**: PWA（静的アセット）と API を同一オリジンで配信できるため、CORS の設定とプリフライトが不要になり、Cookie ベースのトークン運用（D5）も素直に成立する。TLS 終端を Nginx に集約すれば、Go 側は証明書を一切扱わなくてよい。

**設計上、明示しておくべき点**:

- **SSE をバッファリングさせない**: Nginx は既定で上流の応答をバッファリングするため、そのままでは変更通知（D13）がクライアントへ届かない。SSE のパスに対しては `proxy_buffering off` と、アイドル切断を避けるための十分な `proxy_read_timeout` を設定する。**これは設定を忘れると「動いているのに通知だけ来ない」という切り分けの難しい形で現れるため、設計時点で明記する。**
- **SPA のフォールバック**: PWA の任意のパスへ直接アクセスされた場合、Nginx はアプリシェルを返す（`try_files ... /index.html`）。
- **ACME 検証パスの除外**: HTTP → HTTPS リダイレクトから `/.well-known/acme-challenge/` のみ除外しないと、証明書の更新が失敗する。
- **リクエストサイズ**: 添付は S3 へ直接アップロードする（D11）ため Nginx を大きなボディが通ることはないが、`client_max_body_size` が API の要求を拒否しない値であることは確認する。
- **更新後の反映**: Certbot が証明書を更新しても、Nginx は自動では読み込み直さない。更新後に Nginx へリロードを送る仕組み（Certbot の deploy hook、または定期リロード）を必ず組み込む。

**代替案**: ALB や CloudFront で TLS を終端し、証明書を ACM で管理する。運用は楽になるが、AWS のロードバランサ課金が常時発生し、個人利用の規模に対して割高。Certbot は無料で、更新も自動化できる。

**トレードオフ**: 証明書の更新失敗がサービス停止に直結する（→ Risks）。開発中は自己署名証明書で Compose を動かし、Let's Encrypt の初回取得は本番ホスト配備（M9）で行う。

### D18. PostgreSQL は同一ホスト上の自前コンテナで動かす

RDS / Aurora は使わない。`pg_bigm` を含むイメージを `infra/postgres` でビルドし、4 コンテナ構成の一部として Docker Compose で起動する。

**理由**: D12 と D17 が「同一ホストの PostgreSQL コンテナ」を前提にしており、Aurora では `pg_bigm` が使えない。RDS for PostgreSQL でも拡張のバージョン追随とネットワーク分割が増える。個人利用の規模では自前コンテナが最も単純。

### D19. ホストは単一 VPS、オーケストレーションは Docker Compose、ドメインは環境変数

- コンテナ一式は **単一 VPS**（初期は任意の Linux VPS。EC2 でも同じ compose を使う）で動かす。
- オーケストレーションは **Docker Compose**。Kubernetes は個人利用に対して過剰。
- 独自ドメインは **memo.sudabon.com**。DNS の A/AAAA をコンテナホストへ向ける。Compose は `POSTALL_DOMAIN`（既定値 `memo.sudabon.com`）で受け取る。

### D20. 認証 UI は Cognito Hosted UI、認可コード + PKCE

カスタムのサインイン画面は作らない。Cognito Hosted UI でメール／パスワードを入力する。

| クライアント | リダイレクト URI |
|---|---|
| PWA | `https://memo.sudabon.com/auth/callback` |
| Electron | `postall://auth/callback`（カスタム URL スキーム） |
| iOS | `postall://auth/callback` |

サインアウト後の戻り先は PWA が `https://memo.sudabon.com/`、Electron / iOS が `postall://auth/logout`。

**理由**: 3 クライアントで同じ Hosted UI を共有でき、パスワード入力を自前で持たない。Electron / iOS はカスタムスキームで認可コードを受け取る。

### D21. AWS リソースはコンソールで手動構築する

Cognito ユーザープールと S3 バケットは Terraform では管理しない。AWS コンソール（または CLI の単発コマンド）で作り、識別子は環境変数でアプリに渡す。

### D22. 添付の上限

| 項目 | 値 |
|---|---|
| 1 ファイルの最大サイズ | 25 MiB |
| 1 ポストの最大添付数 | 10 |
| 許可 MIME type | `image/jpeg`, `image/png`, `image/gif`, `image/webp`, `application/pdf`, `text/plain`, `text/markdown`, `application/zip`, `application/vnd.openxmlformats-officedocument.wordprocessingml.document`, `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`, `application/vnd.openxmlformats-officedocument.presentationml.presentation` |

サーバとクライアントの両方で同じ上限を検証する。Nginx の `client_max_body_size` は添付が S3 直アップロードであるため API JSON 用に 2m で足りる。

S3 は署名付き URL で直接アクセスする（CloudFront は挟まない）。回収ジョブが論理削除・未確定添付の実体を削除する。ライフサイクルルールは回収ジョブの安全網として「未完了マルチパートを 1 日で破棄」のみ置く。

### D23. 論理削除されたポストはタイムラインから完全に隠す

- チャネルのタイムラインと通常の取得 API は `deleted_at is not null` の行を返さない（D7 のまま）。
- **スレッドの親が削除された場合**: スレッドビューは開ける。親の位置には「このポストは削除されました」プレースホルダを出し、返信一覧は残す。これによりスレッドが参照不能にならない。
- **スレッド内の返信が削除された場合**: スレッドビューからも取り除く（プレースホルダは出さない）。
- 「チャネルにも投稿する」相当の機能は提供しない（D8 および spec の MUST NOT と一致）。

### D24. スレッド返信をチャネルのタイムラインに出さない

Slack の「チャネルにも投稿する」は実装しない。返信は `thread_root_id` を持ち、タイムライン API はそれを返さない。

### D25. 絵文字カタログはデプロイ時の管理コマンド、カスタム png のみ、API 配信

- 登録は `postall-server emoji-sync` をデプロイ時に明示実行する。起動時の自動走査はしない（起動時間と副作用を分離する）。
- Unicode 標準絵文字は併用しない。カタログは `emoji/` の png のみ。
- png は S3 へ上げず、API が `GET /v1/emojis/{shortcode}/image` で配信する。ファイルはコンテナ内の `emoji/` を読む。

### D26. タイムゾーンはクライアントローカル、UI 文言は日本語のみ

- 日付セパレータの日付境界は、表示しているクライアントのローカルタイムゾーンで判定する。サーバは `timestamptz`（UTC 保存）のみを扱う。
- UI 文言は日本語のみ。i18n の枠は本 change では持たない。

## Risks / Trade-offs

- **[`pg_bigm` が選んだ PostgreSQL 環境で使えない]** → 全文検索の方式が根本から変わる。**M0 の最初に、実際に使う PostgreSQL 環境で `create extension pg_bigm` が通ることを確認する。** Aurora PostgreSQL を選ぶ場合は提供されていないため、自前コンテナか RDS for PostgreSQL を選ぶか、`pg_trgm` など別方式へ切り替える判断が必要になる。

- **[Electron 固有 API がコンポーネントに漏れる]** → PWA ビルドが実行時に落ち、PWA 対応が全画面の改修になる。アダプタ層を M3 の最初に作り、**コンポーネントから `window.electron` を直接参照することを lint ルールで禁止する。**

- **[Flutter の WebView による Mermaid 描画が重い]** → タイムラインのスクロールがカクつく。可視領域に入ったポストだけ描画し、同時 WebView 数に上限を設ける。それでも足りない場合はサーバ側での図の事前レンダリングへ退避する。

- **[本 change のスコープが大きい]** → 途中で全体が動かない期間が長引く。実装順序を段階に分け、各段階の終わりに「動くもの」があるようにする。iOS はデスクトップが一通り動き、API が固まってから着手する。

- **[Cognito のトークンをどこに置くか]** → PWA で `localStorage` に置くと XSS でトークンが盗まれる。Electron は OS のセーフストレージ、PWA はメモリ + `httpOnly` Cookie を優先し、`rehype-sanitize` による無害化（`rich-content-rendering`）と併せて XSS 面を塞ぐ。

- **[fractional index のキー長が伸び続ける]** → 同じ位置への挿入を繰り返すとキー文字列が長くなる。生成アルゴリズムに上限を設け、閾値を超えた兄弟グループは並び順を保ったまま再採番する処理を用意する。

- **[「ポストを持つチャネルは削除禁止」が運用上の行き止まりになる]** → 使わなくなったチャネルを片付けられず、ツリーが肥大する。アーカイブ機能が実質的に必要になるため、後続 change として早期に検討する。本 change では、この制約をユーザーに分かる形で説明することだけを行う。

- **[TLS 証明書の自動更新が失敗して気づかない]** → 有効期限切れで全クライアントが接続できなくなる。個人運用では監視が手薄になりがちで、最も現実的な停止要因になる。更新失敗を検知できる形で記録し、期限が迫った状態を通知する手段を用意する。更新後の Nginx リロードを deploy hook として構成に組み込み、「更新されたのに古い証明書を配っている」状態を防ぐ。

- **[Nginx の SSE バッファリング設定漏れ]** → 変更通知が届かず、原因の切り分けに時間を要する。SSE のパスに対する `proxy_buffering off` を設定に含め、実際に他クライアントの投稿が反映されることを M7 の受け入れ確認に含める。

- **[単一ホストへの集約]** → ホストが落ちると全機能が停止する。個人利用の規模では許容するが、PostgreSQL のデータと証明書をボリュームとして分離し、ホスト再作成から復旧できる状態を保つ。

- **[OpenAPI 生成物の陳腐化]** → 仕様と実装がズレる。CI で生成を実行し差分が出たら失敗させる。

- **[階層 D&D の楽観的更新とサーバ拒否の不整合]** → 画面とサーバで階層がズレる。移動 API は「移動後の親と前後の兄弟」を引数に取り、サーバが最終的な `sort_key` を返す。クライアントは返却値で自身の状態を上書きし、拒否された場合はツリー全体を再取得する。

- **[S3 の署名付き URL が漏れる]** → URL を知る者が期限内に添付を取得できる。有効期限を短く保ち、URL をログに残さない。

## Migration Plan

新規実装のためデータ移行は無い。段階を分け、各段階の終わりに検証可能な状態を作る。

- **M0 — 基盤と前提検証**: モノレポ構成、CI、4 コンテナのデプロイ定義（Nginx / Certbot / API / PostgreSQL）。**`pg_bigm` が使える PostgreSQL イメージの確認（D12 の前提）**、Cognito ユーザープールと S3 バケットの用意、ドメイン取得と証明書の初回発行。
- **M1 — 認証とチャネル階層**: `users` / `channels` スキーマ、JWT 検証ミドルウェア、OpenAPI 仕様、チャネル CRUD と移動 API（同名禁止・循環検出・ポスト有りの削除禁止・原子性）。
- **M2 — ポストとスレッド**: `posts` スキーマ、CRUD、keyset pagination、論理削除、スレッド返信。
- **M3 — フロントエンド骨格（Electron）**: プラットフォームアダプタ層、Electron シェル、サインイン、3 ペインレイアウト、チャネルツリーと D&D、タイムライン、入力フォーム。ここで「メモが取れる」状態に到達する。
- **M4 — PWA 配信**: manifest、Service Worker（アプリシェルのキャッシュ）、アダプタのブラウザ実装、インストール可能性の確認。
- **M5 — リッチコンテンツと添付**: Markdown、Shiki、Mermaid（投稿確定時）、無害化、S3 署名付きアップロード／ダウンロード、画像インライン表示。
- **M6 — 絵文字リアクション**: `emoji/` の走査と登録、リアクションの付与・解除・表示。
- **M7 — 全文検索と変更通知**: `pg_bigm` 索引と検索 API、検索 UI、SSE と再接続時の差分取得。
- **M8 — iOS アプリ**: Flutter アプリ。M1〜M7 で確定した API に対して実装する。
- **M9 — デプロイと配布**: 本番ホストへのコンテナ配備、証明書の自動更新と Nginx リロードの動作確認、macOS の署名・公証、PWA の配信、iOS のビルド設定。

ロールバックは、各段階が独立した PR として積まれるため、段階単位の revert で行う。M1 以降でスキーマを変更する場合は、down マイグレーションを必ず伴わせる。

## Open Questions

派生した未決事項のうち、実装に必要なものは D18–D26 で確定済み。本 change のスコープ外として残すもの:

1. **検索のスコープ拡張**: 本 change では本文のみ。チャネル名・ファイル名は後続。
2. **PWA のオフライン範囲**: アプリシェルのみキャッシュする（spec 通り）。直近データのキャッシュは後続。
3. **iOS での PWA 利用**: Flutter アプリがあるため、iOS Safari からの PWA インストールは想定しない。
4. **チャネルのアーカイブ**: データモデルに `archived_at` を先に用意しない。完全に後続 change へ送る。
