## Context

動機は proposal.md の Why を参照。ここでは、設計を縛る現状だけを挙げる。

- **フロントの構成**: フロントは React の単一コードベースである。Electron（`app://localhost`、ローカルの `dist` を読む）、iPhone の PWA、ブラウザの 3 か所で同じコードが動き、差異は `frontend/src/platform/` の adapter で吸収する。秘密情報の保管は adapter の `getSecret` / `setSecret` / `deleteSecret` を使う。Electron では `safeStorage` で暗号化したファイルに、ブラウザでは origin の `localStorage` に入る。
- **前提の change**: `harden-sensitive-data-protection` で、CSP（`script-src 'self' 'wasm-unsafe-eval'`、`connect-src` の限定）、API の許可リスト、論理削除と同時の本文消去が入っている。
- **チャネル**: `channels` は `parent_id` で階層になり、作成・リネーム・移動（親の付け替えと並べ替え）の API がある。チャネルの作成は、`ChannelTree` のインライン入力で行う。
- **ポスト**: 本文は `posts.body`（text）にあり、PGroonga の索引は `body` に張られている。返信は、親の `channel_id` を引き継いで同じチャネルに属する。応答は `post.fromPost` が組み立て、作成・編集の検証は `post.requireContent` が担う。
- **下書き**: 入力フォームの下書きは、`Composer` が `platform.setItem` で端末に平文で保存する。送信の即時反映は Zustand の `pendingPosts` で行い、これは永続化しない。
- **認可**: 許可されたアカウント全員が全データを共有するモデルである。

## Goals / Non-Goals

**Goals:**

- 暗号化の単位をチャネルにする。ポストと返信が暗号化されるかは、属するチャネルだけで決まる。この一致を、API の検証と DB の制約の両方で保証する。
- 鍵の階層と暗号文の形式を、1 か所（フロントの暗号モジュール）に閉じ込める。Electron・PWA・ブラウザで同じ実装を使う。
- サーバーは暗号文を「中身を知らない文字列」として扱う。ただし、平文と暗号文の取り違えや、暗号化チャネルへの添付は、サーバーでも拒否する。
- 鍵の包み方（パスフレーズ・復旧キー）を、後から追加・変更できる形で保存する。

**Non-Goals:**

proposal.md の Non-goals に加えて、次の 3 点も扱わない。

- 鍵の世代交代（新しいマスター鍵での全ポストの再暗号化）。暗号文には鍵の ID を入れるので、後から追加できる。
- サーバー側の悪意ある改変への完全な耐性（暗号文を別のポストへ付け替える攻撃など）。本 change が守るのは機密性である。
- 変更イベント（Realtime）の内容の変更。従来どおり ID だけを運ぶ。

## Decisions

### D1. 鍵の階層: マスター鍵を包み、用途ごとの鍵を導出する

```
パスフレーズ ──PBKDF2-SHA256──▶ 包み鍵 ─┐
復旧キー   ──HKDF-SHA256 ──▶ 包み鍵 ─┴─(AES-GCM で包む)─▶ マスター鍵（32 バイト乱数）
                                                          ├─HKDF info=".../enc"  ─▶ 暗号鍵（AES-256-GCM）
                                                          └─HKDF info=".../auth" ─▶ 所持の証明（32 バイト）
```

- **マスター鍵**: ワークスペースに 1 つあり、初期設定時に端末で生成する（`crypto.getRandomValues`）。サーバーには、包んだ状態だけを置く。
- **暗号鍵**: マスター鍵から HKDF で導出し、ポストの暗号化と復号に使う。ブラウザでは、取り出せない（non-extractable）`CryptoKey` として扱う。
- **所持の証明**: マスター鍵から HKDF で別に導出する。鍵束を書き換える要求（D4）に付けて、マスター鍵を持っていることを示す。サーバーは SHA-256 の値だけを保存して照合する。この値から暗号鍵は導けない。
- **包み方**: AES-GCM で包む。GCM の認証タグにより、誤ったパスフレーズや復旧キーでの解錠は確実に失敗する。鍵の確認用の値を、別に持たなくてよい。
- **パスフレーズ**: PBKDF2-SHA256 で包み鍵を導く。反復は 600,000 回、ソルトは 16 バイトとし、12 文字以上を必須とする。反復回数・ソルト・方式は包んだ鍵と一緒に保存し、後から強化できるようにする。
- **復旧キー**: 32 バイトの乱数を、Crockford Base32 で 4 文字ずつ区切って示す。十分なエントロピーがあるので遅い KDF は使わず、HKDF-SHA256 で包み鍵を導く。

検討した代替案:

- **Argon2id（WASM）**: GPU による総当たりへの耐性は高い。ただし依存の追加が要り、iPhone での所要時間の検証も要る。初版は WebCrypto 標準の PBKDF2 とし、パラメータを保存して後から差し替えられるようにする。
- **パスフレーズから直接暗号鍵を導く**: パスフレーズを変えると全ポストの再暗号化が要り、復旧キーも成り立たない。
- **チャネルごとの鍵**: チャネルごとにパスフレーズを分けると、端末をまたぐ解錠の操作が増える。ワークスペースに 1 つの鍵で、要件（3 台で同じパスフレーズ）を満たせる。暗号文には鍵の ID を入れるので、将来分けることもできる。

### D2. 暗号文の形式

`pe1.<keyId>.<iv>.<ciphertext>`（`iv` と `ciphertext` は base64url）とする。

| 部分 | 内容 |
|---|---|
| `pe1` | 形式の版 |
| `keyId` | マスター鍵の ID（UUID）。サーバーは鍵束と照合し、別の鍵の暗号文の保存を拒否する |
| `iv` | 12 バイトの乱数。暗号化のたびに作る（編集でも作り直す） |
| `ciphertext` | AES-GCM の暗号文と認証タグ |

- AAD は `postall:post:pe1:<keyId>` とする。
- 平文は UTF-8 の本文に長さを前置し、256 バイト単位まで詰め物をしてから暗号化する。暗号文の長さから、本文の長さがそのまま分からないようにするためである。
- サーバーが行うのは、正規表現での形式検証、`keyId` の照合、長さの上限（256 KiB）だけである。

### D3. データモデル: チャネルの属性とポストの一致を DB で保証する

マイグレーション `00017_channel_encryption.sql`:

```sql
alter table channels add column encrypted boolean not null default false;
alter table channels add constraint channels_id_encrypted_key unique (id, encrypted);

-- 作成後の変更を DB でも拒否する（API にも変更の経路は作らない）
create function postall_channels_encrypted_immutable() returns trigger ...
  -- old.encrypted is distinct from new.encrypted なら例外
create trigger channels_encrypted_immutable before update of encrypted on channels ...;

alter table posts
  add column encrypted boolean not null default false,
  add column body_ciphertext text,
  -- ポストの暗号化の有無は、属するチャネルと必ず一致する
  add constraint posts_channel_encryption_fkey
    foreign key (channel_id, encrypted) references channels (id, encrypted) on delete cascade,
  add constraint posts_encrypted_has_no_plain_body check (not encrypted or body = ''),
  add constraint posts_plain_has_no_ciphertext check (encrypted or body_ciphertext is null),
  add constraint posts_live_encrypted_has_ciphertext
    check (not encrypted or deleted_at is not null or body_ciphertext is not null);

create table encryption_keyring (
  key_id uuid primary key,
  singleton boolean not null default true unique check (singleton),
  auth_hash bytea not null,          -- SHA-256(所持の証明)
  passphrase_wrap jsonb not null,    -- {kdf, iterations, salt, iv, wrapped}
  recovery_wrap jsonb not null,      -- {kdf, salt, info, iv, wrapped}
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

- **一致の保証**: `posts.encrypted` は、チャネルの値を複製した列である。複合外部キー `(channel_id, encrypted)` によって、暗号化チャネルに平文のポストが入ることも、その逆も、DB が拒否する。
  - 返信は親と同じ `channel_id` に入るので、スレッドも自動的に同じ扱いになる。
  - 検索の SQL は、`posts.encrypted` で除外できる（結合が要らない）。
- **暗号文の置き場所**: 暗号文は `body` ではなく別の列に置く。`body` は空のままなので、PGroonga の索引に暗号文の文字列が入らない。検索 SQL には、意図を明示するため `and not p.encrypted` を加える。
- **削除**: `SoftDeletePost` は、`body = ''` に加えて `body_ciphertext = null` にする。`encrypted` は削除後も残る。
- **鍵束**: `encryption_keyring` は、`singleton` の一意制約で 1 行に限る。RLS を有効にし、`anon` / `authenticated` の権限を剥がす（`00013` と同じ方針）。
- **Down**: 暗号化チャネルが 1 件でもあれば、例外で失敗させる。暗号文を失わないためである。

検討した代替案:

- **`posts.encrypted` を持たず、チャネルを結合して判定する**: DB の制約（CHECK）でポストの中身とチャネルの属性の一致を表せず、トリガーが要る。複製した列と複合外部キーの方が、宣言的で検証しやすい。

### D4. API

- **`Channel`**: `encrypted: boolean` を追加する。
- **`CreateChannelRequest`**: `encrypted?: boolean`（既定 false）を追加する。`RenameChannelRequest` と `MoveChannelRequest` には足さないので、作成後に変える経路は無い。
- **`Post`**: `encrypted: boolean` と `ciphertext: string | null` を追加する。暗号化チャネルのポストでは、`body` は空文字になる。
- **`CreatePostRequest`（作成・返信で共用）と `EditPostRequest`**: `ciphertext` を追加する。
- **サーバーの検証**（`post.Service`。対象チャネルの `encrypted` で分岐する）:

  | 条件 | 応答 |
  |---|---|
  | 暗号化チャネルで、`ciphertext` が無い・`body` が空でない | 400 `encryption_required` |
  | 非暗号化チャネルで、`ciphertext` がある | 400 `encryption_not_allowed` |
  | 暗号化チャネルで、`attachmentIds` が空でない | 400 `encrypted_attachments_unsupported` |
  | 暗号文の形式・`keyId` の不一致 | 400 `invalid_ciphertext` |
  | 鍵束が無い状態で、暗号化チャネルへ投稿 | 409 `encryption_not_configured` |

- **チャネル作成の検証**: `encrypted: true` のチャネル作成は、鍵束が無ければ 409 `encryption_not_configured` で拒否する。初期設定の前に暗号化チャネルができて、投稿できない状態になるのを防ぐ。
- **鍵束の API**（すべて許可リストの内側に置く）:
  - `GET /v1/encryption/keyring`: 鍵束（`keyId`、2 つの包み）を返す。未設定なら 404 `encryption_not_configured`。
  - `POST /v1/encryption/keyring`: 初期設定。既にあれば 409 `encryption_already_configured`（`insert ... on conflict do nothing`）。
  - `PUT /v1/encryption/keyring/{kind}`（`kind` = `passphrase` | `recovery`）: 包みを置き換える。ヘッダー `X-Postall-Key-Proof` に所持の証明を付け、サーバーは SHA-256 を定数時間で比較する。一致しなければ 403 `key_proof_mismatch`。

検討した代替案:

- **書き換えに所持の証明を求めない**: 盗まれたアクセストークン 1 つで 2 つの包みを壊され、全ての暗号化チャネルが復号できなくなる。

### D5. クライアントの鍵の状態

- **暗号モジュール**: `frontend/src/crypto/`（新規）に置き、D1・D2 の処理だけを持つ。React に依存させず、単体テストの対象にする。
- **状態の管理**: `EncryptionProvider`（新規、`AuthProvider` の内側）が、次を持つ。
  - 状態（`unconfigured` / `locked` / `unlocked`）
  - メモリ上の暗号鍵
  - 復号結果のキャッシュ `Map<ciphertext, plaintext>`（メモリのみ）
  - 世代番号
- **キャッシュ**: TanStack Query のキャッシュには、暗号文しか入らない。ロック時はキャッシュを消し、世代番号を進めて再描画させる。
- **自動ロック**: 記憶しない設定の端末では、`pointerdown` / `keydown` / `wheel` / `touchstart` を見て、15 分操作が無ければロックする。`visibilitychange` でページが見えるようになったときにも経過時間を確かめ、スリープ明けを取りこぼさない。
- **サインアウト**: `AuthProvider` の `signOut`（`account_not_allowed` の経路も含む）から、`EncryptionProvider` の `forget()` を呼ぶ。
- **ロック時に消すもの**: 暗号化チャネルの入力フォームの下書き、編集中の平文、送信待ち・送信失敗の平文。
- **送信待ちのポスト**: 送信前に暗号文を作り、一緒に持つ。ロック後は「ロック中」の表示のまま、暗号文で再送できる。

### D6. 端末への記憶（platform adapter）

PlatformAdapter に `encryptionKeyStore`（`canPersist()` / `save(...)` / `load()` / `clear()`）を追加する。

| adapter | 保存するもの | 保存先 | `canPersist()` |
|---|---|---|---|
| electron | マスター鍵の値（base64） | 既存の `secret:*`（`secret-store.mjs` が `safeStorage` で暗号化） | 新しい IPC `secret:persistent` が `safeStorage.isEncryptionAvailable()` を返す |
| browser（PWA・会社支給 Mac） | 取り出せない暗号鍵の `CryptoKey` | IndexedDB の `postall-keys` | IndexedDB が使えれば true |
| fake | メモリ | — | テストで切り替え |

- **ブラウザ**: 記憶しても、スクリプトは鍵の値を取り出せない。XSS でその場の復号に使われることは防げないので、CSP で抑える。
- **記憶の選択**: 解錠ダイアログの「この端末で記憶する」で選び、既定はオフとする。会社支給 Mac ではオフのまま使う運用を、ドキュメントに書く。

### D7. 鍵束の変更と復旧

- **パスフレーズの変更・復旧キーの再発行**: 解錠済みでも、現在のパスフレーズか復旧キーの入力を求める。入力からマスター鍵を一時的に取り出せる形で解き、新しい包みを作り、所持の証明を付けて `PUT` する。終わったら一時的な値を捨てる。
- **復旧**: 復旧キーで解錠した直後に、新しいパスフレーズの設定へ進める（同じ `PUT /passphrase`）。
- **他の端末**: マスター鍵は変わらないので、記憶済みの端末は読み続けられる。紛失した端末の失効は、Supabase のセッション失効と許可リストで行う（鍵の世代交代は Non-Goal）。

### D8. 画面

- **チャネルの作成**:
  - `ChannelTree` のインライン入力に「暗号化」の切り替え（鍵のアイコン）を追加する。既定はオフ。
  - 暗号化を選んだときに鍵束が未設定なら、先に初期設定のダイアログを出し、完了後にチャネルを作成する。
- **印**: チャネルツリーの行と、タイムラインの見出しに、暗号化チャネルの印（鍵のアイコン）を付ける。
- **入力フォーム**（`Composer`。暗号化チャネルと、そのスレッド）:
  - 「暗号化して送信」の表示を出す。
  - 添付の操作を出さない。
  - 下書きは `platform.setItem` ではなく、メモリの `Map` に置く。
  - ロック中は、送信時に解錠を求める。入力は保持する。
- **表示**:
  - `PostBody` は、暗号化チャネルのポストのとき、`useDecryptedBody` の結果を既存の `MarkdownBody` に渡す。無害化と CSP の経路は、非暗号化チャネルと同じである。
  - ロック中は `LockedPostBody`（「🔒 ロック中・解錠する」）、復号できないときは `UndecryptablePostBody` を出す。
  - ロック中は、編集と返信の導線を出さない。
- **編集フォーム**: 暗号化チャネルのポストの編集は、解錠中だけ開ける。ロック時に閉じる。
- **検索**: 検索ダイアログのチャネルの絞り込みには、非暗号化チャネルだけを出す。

### D9. テスト方針

- **暗号モジュール**: vitest で、往復・誤った鍵での失敗・改ざんの検出・詰め物・版の判定を確かめる。
- **サーバー**: 検証規則、DB の制約（複合外部キー・CHECK・不変性のトリガー）、鍵束の API を、`internal/httpapi` の integration test と migration test で確かめる。
- **E2E**: `installApiMock` に、暗号化チャネルと鍵束、サーバーと同じ検証規則を持たせる。fixture の暗号文は、テスト用のパスフレーズからテスト内で作る。

## Risks / Trade-offs

- **[鍵束が漏れると、パスフレーズへのオフラインの総当たりが可能]** → 12 文字以上を必須にし、PBKDF2 は 600,000 回とする。生成したパスフレーズの使用を推奨し、パラメータを保存するので Argon2id へ移せる。
- **[Web 版は、配信された JavaScript を信頼するしかない]** Vercel が侵害されて改変したコードが配信されると、ブラウザ・PWA で表示した平文が盗まれ得る。 → Electron はローカルの `dist` を読むので、この経路を持たない。最も秘匿性の高い操作は Electron で行うことを、ドキュメントに書く。CSP と許可リストで、改変コードの持ち出し先を絞る。
- **[解錠中の端末への XSS やマルウェア]** → 鍵は取り出せない形にし、CSP を入れる。それでも、表示中の平文と解錠中の復号操作は守れない。会社支給 Mac では記憶せず、自動ロックを使う。
- **[パスフレーズと復旧キーの両方を失うと復号できない]** → 初期設定と再発行で、保管の確認を必須にする。DEPLOYMENT.md / SETUP_GUIDE.md に、2 か所での保管を書く。
- **[既存の秘匿メモは移行できず、投稿し直しになる]** → Non-goal として明記する。非暗号化チャネルに残した旧メモは、削除すれば本文が DB から消える（`harden-sensitive-data-protection`）。
- **[暗号文の長さと、メタデータ（チャネル名・時刻・返信数）は漏れる]** → 長さは 256 バイト単位に丸める。チャネル名は秘匿情報を含めない運用とし、ドキュメントに書く。
- **[古いクライアント（未更新の Electron など）は、暗号化チャネルのポストを空として表示する]** → DB の制約とサーバーの検証で、平文の投稿・上書きは拒否されるので、データは壊れない。Electron の配布を、web のデプロイと合わせて更新する。
- **[iPhone の PWA では、端末内のストレージが消されることがある]** → 記憶した鍵が消えても、パスフレーズを入れ直せばよく、データは失われない。

## Migration Plan

1. 本 change をマージし、`migrate` workflow で `00017` を適用する。列・制約・テーブルを足すだけで、既存のチャネルとポストはすべて非暗号化のまま動く。
2. `deploy` workflow で API と web をデプロイし、Electron を再ビルドして配布する。
3. いずれかの端末で暗号化チャネルを作成する（初期設定を伴う）。復旧キーを 2 か所に保管し、各端末で解錠を確認する。

ロールバック:

- アプリを直前のデプロイへ戻すと、暗号化チャネルのポストは空として表示される。DB の制約によって、平文での投稿や上書きは防がれる。
- `00017` の Down は、暗号化チャネルが無いときだけ成功させる。
