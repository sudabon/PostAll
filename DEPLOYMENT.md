# DEPLOYMENT

Supabase（Free）と Vercel（Hobby）へ PostAll を構築し、`memo.sudabon.com` を切り替えるまでの手順。日常の反映手順は「11. 日常運用」にある。

- スキーマの正は `backend/migrations`（goose）。Supabase Dashboard から DDL を直接流さない。
- 本番反映は **GitHub Actions の手動実行のみ**。`vercel.json` の `git.deploymentEnabled: false` により push ではデプロイされない。
- 各手順の `- [ ]` は実施チェック用。openspec の `openspec/changes/vercel-supabase-migration/tasks.md` との対応は「13. tasks.md 対応表」を参照。

## 1. 全体の流れ


| Phase | 内容                          | 中断できるか                   |
| ----- | --------------------------- | ------------------------ |
| 2     | Supabase プロジェクト構築           | できる                      |
| 3     | Vercel プロジェクト構築と疎通確認        | できる（ここで設計見直しの判断）         |
| 4     | GitHub Actions の secrets 登録 | できる                      |
| 5     | 初回リリース（migrate → deploy）    | できる                      |
| 6     | ドメイン切替                      | **切替中は不可**。旧環境を残したまま実施する |
| 7     | 受け入れ確認                      | できる                      |
| 8     | 観察と旧環境の破棄                   | できる                      |




## 2. 前提

- `sudabon/PostAll` が **個人アカウント所有**であること。Vercel Hobby は Organization 所有のリポジトリへ接続できない。
- 手元に Go 1.26+ / Node.js 22+ / Supabase CLI / Vercel CLI / `gpg` / `psql`。
- Supabase・Vercel・GitHub の各アカウント。GitHub OAuth App を作れる権限。
- 旧環境（AWS Cognito / S3 / VPS）は Phase 8 まで**残しておく**。

---



## 3. Phase 2: Supabase 構築



### 3.1 プロジェクト作成

- [x] Supabase Dashboard で **Free プラン**のプロジェクトを作成する。リージョンは利用地に近いもの（例: Northeast Asia (Tokyo)）。
- [x] データベースパスワードを生成し、パスワードマネージャへ保管する。以後再表示できない。
- [x] プロジェクト参照 ID（`<project-ref>`）を控える。API の `SUPABASE_URL` は `https://<project-ref>.supabase.co`。



### 3.2 接続文字列を控える

Dashboard の **Connect** から 3 種類をコピーする。ホスト名の形式はプロジェクトごとに異なるため、**必ず画面の表示値を使う**（推測しない）。


| 用途                             | モード                | ポート  | 使う場所                            |
| ------------------------------ | ------------------ | ---- | ------------------------------- |
| API サーバ                        | Transaction pooler | 6543 | Vercel の `DATABASE_URL`         |
| migrate / emoji-sync / db dump | **Session pooler** | 5432 | GitHub Actions の `DATABASE_URL` |
| 緊急時の手元作業                       | Direct             | 5432 | IPv6 環境からのみ                     |


- [x] 3 種類を控えた。
- [x] Direct 接続は IPv6 専用であり、このマシンや GitHub-hosted runner からは到達しないことを理解している（IPv4 アドオンは不要）。



### 3.3 拡張の確認

Dashboard → SQL Editor で実行する。**ここが通らなければ先へ進まない。**

```sql
create extension if not exists pgcrypto;
create extension if not exists pgroonga;
select extname, extversion from pg_extension where extname in ('pgcrypto', 'pgroonga');
```

- [x] `pgcrypto` が作れる。
- [x] `pgroonga` が作れる。

`pgroonga` が Free で作れない場合は、Pro への引き上げ / `pg_trgm` への後退（最小検索文字数を 3 文字へ引き上げ、`full-text-search` 仕様の変更が必要）/ 索引なし `LIKE` のいずれかを選ぶ判断が先に必要になる。マイグレーション 00008 が失敗する状態で Phase 5 へ進んではいけない。

### 3.4 JWT 署名鍵を ES256 にする

API の検証器（`backend/internal/auth/verifier.go`）は **ECDSA P-256（ES256）** の JWKS を前提とする。共有シークレット（HS256）のままでは全リクエストが 401 になる。

- [x] Authentication → JWT Keys で **ECC (P-256)** の鍵を作成し、現行鍵から rotate して署名鍵にする。
- [x] JWKS が ES256 を返すことを確認する。

```bash
curl -s https://<project-ref>.supabase.co/auth/v1/.well-known/jwks.json | jq '.keys[] | {kid, kty, alg, crv}'
# kty: "EC", alg: "ES256", crv: "P-256" が含まれること
```

検証器が期待する値は次のとおり。Dashboard 側で変更しない。


| 項目       | 値                                                                 |
| -------- | ----------------------------------------------------------------- |
| JWKS URL | `https://<project-ref>.supabase.co/auth/v1/.well-known/jwks.json` |
| issuer   | `https://<project-ref>.supabase.co/auth/v1`                       |
| audience | `authenticated`                                                   |




### 3.5 GitHub OAuth App と provider 設定

サインインは GitHub provider に固定する。**OAuth App の callback はアプリの URI ではなく Supabase の callback**。

- [x] GitHub → Settings → Developer settings → OAuth Apps で本番用 App を作成する。
  - Homepage URL: `https://memo.sudabon.com`
  - Authorization callback URL: `https://<project-ref>.supabase.co/auth/v1/callback`
- [x] Client ID と Client secret を控える。
- [x] Supabase の Authentication → Sign In / Providers → GitHub を有効化し、Client ID / secret を登録する。
- [x] 同じ画面で **Email provider を無効化**する。
- [x] **新規サインアップを無効化**する（Allow new users to sign up をオフ）。招待制を成立させる要。

ローカル検証用の OAuth App は callback が `http://127.0.0.1:54321/auth/v1/callback` になるため、本番用とは別に作る。ローカルは `.env` の `SUPABASE_AUTH_EXTERNAL_GITHUB_CLIENT_ID` / `SUPABASE_AUTH_EXTERNAL_GITHUB_SECRET` に入れる。

### 3.6 Redirect URL 許可リスト

- [x] Authentication → URL Configuration の Redirect URLs へ次を登録する。


| クライアント         | URI                                      |
| -------------- | ---------------------------------------- |
| PWA            | `https://memo.sudabon.com/auth/callback` |
| Electron / iOS | `postall://auth/callback`                |


- [x] Site URL を `https://memo.sudabon.com` にする。



### 3.7 Storage バケットと S3 アクセスキー

- [x] Storage で **private** バケットを 2 つ作る。公開バケットにしない。


| バケット名         | 用途              | 環境変数              |
| ------------- | --------------- | ----------------- |
| `attachments` | 添付（最大 25 MiB/件） | `S3_BUCKET`       |
| `emojis`      | カスタム絵文字         | `EMOJI_S3_BUCKET` |


- [x] Storage → Settings → S3 Connection で **エンドポイントとリージョン**を控える（表示値をそのまま使う）。
- [x] S3 access key を新規発行し、`S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` を控える。secret は再表示できない。
- [x] 署名なしの直接アクセスが内容を返さないことを確認する。

```bash
curl -sS -o /dev/null -w '%{http_code}\n' \
  "https://<project-ref>.supabase.co/storage/v1/object/public/attachments/anything"
# 400 番台であること。200 が返るならバケットが public になっている
```



### 3.8 API キーを控える

- [x] Project Settings → API Keys の **publishable key**（クライアント配布用）を控える。フロントの `VITE_SUPABASE_PUBLISHABLE_KEY` と iOS の `--dart-define=POSTALL_SUPABASE_PUBLISHABLE_KEY` に使う。
- [x] secret / service_role キーは**どこにも配置しない**。この構成では使わない。



### 3.9 マイグレーションの初回適用

Phase 4 の `migrate` workflow でも適用できるが、拡張の可否を早く確かめるため手元から実行してよい。Session pooler の URL を使う。

```bash
cd backend
DATABASE_URL='<session-pooler-url>' go run ./cmd/postall-server migrate
DATABASE_URL='<session-pooler-url>' go run ./cmd/postall-server migrate-check
# migrate-check: database schema is current と出れば適用完了
```

- [x] 00001〜00015 がエラーなく適用された。



### 3.10 realtime.messages の RLS

00011 は `realtime.messages` の所有者が `supabase_admin` の場合に `insufficient_privilege` を捕捉して**スキップする**。マネージド環境ではスキップされる可能性が高いので、必ず結果を確認する。

```sql
select policyname, roles, qual
from pg_policies
where schemaname = 'realtime' and tablename = 'messages';
```

- [x] `postall_events_select` が無ければ SQL Editor で作る。

```sql
alter table realtime.messages enable row level security;
create policy postall_events_select on realtime.messages
  for select to authenticated
  using (realtime.topic() = 'postall:events' and extension = 'broadcast');
```

`42501` で作れない場合は Database → Policies から schema `realtime` / table `messages` に、`authenticated` の SELECT を同じ条件で追加する。`using (true)` **は使わない**（他トピックまで購読可能になる）。

- [x] Realtime → Settings で broadcast が有効であることを確認する。



### 3.11 利用者の事前登録（招待制）

signup を無効化しているため、**初回 GitHub サインインより先に**ユーザーを作る必要がある。

- [x] Authentication → Users で、GitHub が返す**検証済みメールと完全に同一**のアドレスでユーザーを作成し、確認済みにする。
- [x] 以後の GitHub サインインが自動 identity linking で既存ユーザーへ結び付くことを Phase 7 で確認する。

---



## 4. Phase 3: Vercel 構築



### 4.1 プロジェクト作成

- [x] Vercel で **Hobby プラン**のプロジェクトを作成し、`sudabon/PostAll` を接続する。本番昇格はまだ行わない。
- [x] Settings → Git で自動デプロイが無効になっていることを確認する（`vercel.json` の `git.deploymentEnabled: false` が効く）。



### 4.2 `services` が Hobby で使えるかの検証 ★判断ポイント

`vercel.json` は 1 プロジェクト内に `web`（`frontend/`）と `api`（`backend/`）の 2 サービスを置く構成。**Hobby でこれが使えるかを最初に確かめる。**

```bash
vercel link                                  # 対象プロジェクトへ紐付け
vercel pull --yes --environment=production
vercel build                                 # ローカルでビルドできるか
vercel deploy --prebuilt --archive=tgz --yes # プレビュー（Git 連携ではなく CLI から作る）
```

`vercel build` のあとは `--prebuilt` **が必須**。これがないと成果物ではなくソースを送り直し、初回デプロイでは API が `projectSettings` を要求して落ちる。`--yes` はフレームワーク自動検出の確認をスキップする（エラー文の `skipAutoDetectionConfirmation=1` に相当）。GitHub Actions の `deploy` も同じ `--prebuilt` 経路。

プロジェクトにデプロイが 1 件も無い場合、Vercel は **初回を本番扱い**にする。この段階では環境変数未設定のままでよい（`/health` は DB をスキップする）。

- [x] 2 サービスがビルドされ、プレビュー URL が発行された。

使えない場合のフォールバック（設計の D1）: フロントと API を **2 プロジェクトに分け**、フロント側 `vercel.json` の rewrite で `/v1/`* を API プロジェクトへプロキシする。ブラウザから見たオリジンは変わらないため CORS は不要のままで、クライアントの改修も要らない。この場合は `VERCEL_PROJECT_ID` が 2 つになるため、`deploy` workflow を 2 ジョブへ分ける修正が必要になる。

### 4.3 プレビューでの疎通確認 ★判断ポイント

環境変数を入れる前のプレビューで確認する（`DATABASE_URL` 未設定なら `/health` は DB をスキップする）。

```bash
curl -s https://<preview-url>/health | jq
# {"status":"ok","database":"skipped"}

curl -s -o /dev/null -w '%{http_code}\n' https://<preview-url>/
# 200（PWA のシェルが返る）
```

- [x] `/health` が 200 を返す。
- [x] ルート URL が PWA を返す。

**ここが通らない場合は以降へ進まず、設計を見直す。**

### 4.4 環境変数の登録

Settings → Environment Variables で **Production** に登録する（`vercel env add <NAME> production` でも可）。登録時に種類を **Config** か **Secret** で選ぶ。`VITE_`* はビルド時に埋め込まれるため、GitHub secrets ではなく **Vercel 側**に置く。`deploy` workflow は `vercel pull` で取得した production 設定を使ってビルドする。


| 変数                                          | 種類     | 値                                   | 備考                   |
| ------------------------------------------- | ------ | ----------------------------------- | -------------------- |
| `DATABASE_URL`                              | Secret | Transaction pooler の URL（**6543**）  | Session pooler を入れない |
| `SUPABASE_URL`                              | Config | `https://<project-ref>.supabase.co` | 末尾スラッシュなし            |
| `S3_ENDPOINT`                               | Config | Storage の S3 エンドポイント                | Dashboard の表示値       |
| `S3_REGION`                                 | Config | プロジェクトのリージョン                        | 例: `ap-northeast-1`  |
| `S3_BUCKET`                                 | Config | `attachments`                       |                      |
| `EMOJI_S3_BUCKET`                           | Config | `emojis`                            |                      |
| `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | Secret | 3.7 で発行した値                          |                      |
| `CRON_SECRET`                               | Secret | 32 バイト以上のランダム値                      | 下記コマンドで生成            |
| `VITE_SUPABASE_URL`                         | Config | `https://<project-ref>.supabase.co` | ビルド時                 |
| `VITE_SUPABASE_PUBLISHABLE_KEY`             | Config | publishable key                     | ビルド時                 |
| `VITE_API_BASE_URL`                         | Config | 空文字（同一オリジン）                         | 未登録でも可               |


```bash
openssl rand -base64 32   # CRON_SECRET の生成
```

- [x] 上記を Production へ登録した。
- [x] `CRON_SECRET` を控えた（GitHub secrets にも同じ値を入れる）。

`CRON_SECRET` を設定すると、Vercel Cron は `Authorization: Bearer <CRON_SECRET>` を付けて `vercel.json` の `crons` を叩く。ハンドラは GET / POST の両方を受ける。

### 4.5 Cron の確認

Hobby の Cron は **1 日 1 回・起動精度 ±59 分**。`vercel.json` には次の 2 本が入っている。


| パス                           | スケジュール       | 役割             |
| ---------------------------- | ------------ | -------------- |
| `/internal/attachments/reap` | `0 4 * * *`  | 添付回収           |
| `/internal/events/prune`     | `15 4 * * *` | 変更イベントの 30 日整理 |


- [x] Settings → Cron Jobs に 2 本が認識されている（本番昇格後に有効化される）。

主系は GitHub Actions（6 時間ごと）で、Vercel Cron は二重化。エンドポイントは冪等なので二重起動は無害。

### 4.6 デプロイ用の資格情報

- [ ] Account Settings → Tokens で `VERCEL_TOKEN` を発行する。スコープは **チーム**（Hobby なら自分のチーム）にする。**プロジェクト限定トークンは使わない。**
- [x] `VERCEL_ORG_ID` と `VERCEL_PROJECT_ID` を控える。`vercel link` 後の `.vercel/repo.json` に入っている。

```bash
# VERCEL_ORG_ID = orgId、VERCEL_PROJECT_ID = id
cat .vercel/repo.json
```

Vercel CLI 59 の `vercel pull` は、プロジェクト限定トークンだと `GET /v2/user` が 404・`GET /teams/...` が 403 になり、**実際には権限不足なのに** `Could not retrieve Project Settings. To link your Project, remove the .vercel directory` と出る。CI の `.vercel` は gitignore 済みなので、その指示に従っても直らない。チーム（または Full Account）スコープで再発行し、GitHub の `VERCEL_TOKEN` secret を更新する。

---



## 5. Phase 4: GitHub Actions の secrets

`migrate` / `deploy` は `production` environment を参照する。repository secrets でも動くが、環境を分けるなら Settings → Environments → `production` に置く。`ops` は repository secrets を参照する。


| Secret                                                                    | 使う workflow                     | 値                                               |
| ------------------------------------------------------------------------- | ------------------------------- | ----------------------------------------------- |
| `DATABASE_URL`                                                            | migrate / deploy / ops(db-dump) | **Session pooler**（5432）                        |
| `EMOJI_S3_BUCKET`                                                         | migrate(emoji-sync)             | `emojis`                                        |
| `S3_ENDPOINT` / `S3_REGION` / `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | migrate(emoji-sync)             | 3.7 の値                                          |
| `VERCEL_TOKEN` / `VERCEL_ORG_ID` / `VERCEL_PROJECT_ID`                    | deploy                          | 4.6 の値                                          |
| `APP_URL`                                                                 | ops(reap / prune-events)        | `https://memo.sudabon.com`（切替前は Vercel の本番 URL） |
| `CRON_SECRET`                                                             | ops(reap / prune-events)        | Vercel と**同じ値**                                 |
| `DUMP_PASSPHRASE`                                                         | ops(db-dump)                    | 十分に長いランダム値。復元に必須                                |


- [x] 上記をすべて登録した。
- [x] `DUMP_PASSPHRASE` をパスワードマネージャへ保管した（**紛失するとバックアップを復号できない**）。
- [x] GitHub の Billing → Budgets and alerts で **Actions storage の予算を** `$0` にした。上限到達で停止し、追加課金へ移行しない。

---



## 6. Phase 5: 初回リリース

**migrate → deploy の順**に、GitHub の Actions 画面から**同じ Git ref**を選んで手動実行する。互いを自動起動しない。共通の `production-release` concurrency group により同時実行もされない。

- [x] `migrate` workflow を実行する。goose 適用が成功した後だけ `emoji-sync` が走る。
- [x] `emoji-sync` が完了し、Storage の `emojis` バケットに png が並んだ。
- [x] `deploy` workflow を実行する。冒頭の `migrate-check` が未適用マイグレーションを**読み取り検査だけ**し、1 件でもあれば DB を変更せずに落ちる。
- [x] 本番 URL で `/health` が `{"status":"ok","database":"ok"}` を返す。

```bash
curl -s https://<production-url>/health | jq
```

手元で同じ検査をするなら次を使う。

```bash
cd backend && DATABASE_URL='<session-pooler-url>' go run ./cmd/postall-server migrate-check
```

---



## 7. Phase 6: ドメイン切替

旧環境が `memo.sudabon.com` を提供している間に準備し、最後に向き先だけを変える。

- [x] Vercel を **本番昇格**する（Production への promote）。
- [x] Vercel の Domains へ `memo.sudabon.com` を追加し、表示された DNS レコードを控える。
- [x] **切替の 24 時間以上前**に、現行 DNS レコードの TTL を 300 秒へ短縮する。
- [x] TTL の短縮が伝播した後、レコードを Vercel の指示値へ変更する。
- [x] 証明書が自動発行され、`https://memo.sudabon.com` が Vercel を指すことを確認する。

```bash
dig +short memo.sudabon.com
curl -sI https://memo.sudabon.com/health | head -3
```

- [x] `APP_URL` secret を `https://memo.sudabon.com` に更新する（Vercel の本番 URL を入れていた場合）。
- [x] Supabase の Site URL / Redirect URLs と GitHub OAuth App の Homepage URL が新ドメインと一致している。

問題が出た場合は DNS を旧環境へ戻す。TTL 300 秒なので数分で戻る。**この時点では旧 VPS を止めない。**

---



## 8. Phase 7: 受け入れ確認

Web（PWA）、Electron、iOS の 3 クライアントすべてで確認する。

### 8.1 機能

- [ ] GitHub サインイン（事前登録済みメール）が通り、既存ユーザーへ紐付く。
- [ ] **未登録**の GitHub アカウントではサインインできない。
- [ ] 投稿・編集・論理削除・スレッド返信。
- [ ] 添付のアップロードとダウンロード（25 MiB 超が拒否されること）。
- [ ] 絵文字リアクションの付与と解除。
- [ ] 絵文字画像が表示される（サーバは Storage の `Head` 後に 304、または署名付き URL へ 302 を返す。`fetch` → `blob()` が 302 に追随することの確認）。
- [ ] 全文検索（日本語 2 文字、語の途中一致、大文字小文字非依存）。
- [ ] 他クライアントの変更が表示中の画面へ反映される。



### 8.2 同期の退避経路

- [ ] Realtime を切断した状態（ネットワーク遮断や購読失敗）で、15 秒間隔のポーリングへ退避して変更が反映される。
- [ ] iOS は購読失敗中に接続状態が `degraded` と表示され、ポーリング成功では `online` に戻らない。
- [ ] 再接続時に指数バックオフで復帰する。



### 8.3 経路とセキュリティ

- [ ] `/v1/*` の存在しないパスが**アプリシェルではなく API のエラー応答**を返す。

```bash
curl -s -i https://memo.sudabon.com/v1/does-not-exist | head -5
# Content-Type: application/json であること。text/html なら rewrite の順序を疑う
```

- [ ] 内部エンドポイントが認可なしで叩けない。

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://memo.sudabon.com/internal/events/prune
# 401
```

- [ ] `authenticated` の JWT で PostgREST 経由の直接読み書きができない（00013 の lockdown が効いている）。
- [ ] 匿名で `postall:events` を購読できない。
- [ ] パッケージ済み Electron アプリでサインインからタイムライン表示までが通る。



### 8.4 定期実行

- [ ] `ops` workflow を手動実行し、`reap` / `prune-events` / `db-dump` の 3 ジョブが成功する。
- [ ] `db-dump` の Artifact が `postall.dump.sql.gz.gpg` **のみ**であり、平文が含まれない。
- [ ] 暗号化ダンプを復号し、空の DB へ復元できる（README の「暗号化バックアップ」の手順）。

---



## 9. Phase 8: 観察と旧環境の破棄

- [ ] 1 週間、`ops` の schedule 実行が動き、Supabase プロジェクトが pause されないことを観察する。
- [ ] Database → Reports と Storage 使用量を確認する（Free は DB 500 MB / Storage 1 GB）。
- [ ] 問題がなければ **AWS Cognito ユーザープール**、**S3 バケット**、**旧 VPS** を破棄する。
- [ ] 旧環境の DNS レコードと証明書設定を削除する。

破棄は最後。ロールバック手段を失う操作なので、Phase 8 の観察が終わるまで実施しない。

---



## 10. 監視

SQL Editor で定期的に確認する。

```sql
-- Realtime 通知の失敗件数（日次）。増え続けるならトリガーか RLS を疑う
select * from postall_notify_failures order by day desc limit 7;

-- 変更イベントの保持状況。prune が動いていれば最古が 30 日以内に収まる
select count(*), min(created_at), max(created_at) from change_events;
select * from change_event_retention;   -- pruned_through が単調増加する
```

---



## 11. 日常運用



### 11.1 本番へ反映する

```
1. GitHub → Actions → migrate → Run workflow（対象の ref を選択）
2. 成功を確認
3. GitHub → Actions → deploy → Run workflow（同じ ref を選択）
```

スキーマ変更がない版でも `deploy` は手動でのみ開始する。マイグレーションが未適用なら `deploy` は DB を変更せずに失敗する。

### 11.2 ロールバック

- **アプリ**: 直前の ref を選んで `deploy` を再実行する。または Vercel の Deployments から以前のデプロイを Promote する。
- **スキーマ**: goose の down は使わない前提（00008 の down は `pg_bigm` 索引を復元できない環境で意図的に失敗する）。前方修正のマイグレーションを追加して `migrate` を実行する。
- **データ**: 暗号化ダンプから復元する（README の「暗号化バックアップ」）。**Supabase Auth のユーザーはダンプに含まれない**。



### 11.3 利用者を追加する

1. Supabase の Authentication → Users で、GitHub の検証済みメールと同一のアドレスで確認済みユーザーを作る。
2. 本人に GitHub サインインしてもらう。identity linking で既存ユーザーへ結び付く。



### 11.4 絵文字を追加する

`emoji/` に png を追加してコミットし、`migrate` workflow を実行する（`emoji-sync` が同じ workflow に含まれる）。チェックサムが一致するものは再アップロードされない。

---



## 12. トラブルシューティング


| 症状                                               | 確認する箇所                                                                                                                                                     |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 全 API が 401                                      | JWT 署名鍵が ES256 か（3.4）。`SUPABASE_URL` の末尾スラッシュ。issuer / audience                                                                                            |
| サインインが Redirect エラー                              | Supabase の Redirect URLs（3.6）と GitHub OAuth App の callback（3.5）                                                                                            |
| サインインは通るが投稿が他人のものに見えない                           | `users.auth_subject` と JWT の `sub` の対応。別プロジェクトへ復元した場合は一致しない                                                                                                |
| 変更が他クライアントへ届かない                                  | `postall_notify_failures` の件数。`realtime.messages` の RLS（3.10）。ポーリング退避で反映されるなら Realtime 側の問題                                                                |
| 検索が 0 件のまま                                       | `pgroonga` 拡張と索引。壊れていれば `REINDEX INDEX posts_body_pgroonga;`（実索引名は `\d posts` で確認）                                                                         |
| 添付のアップロードが署名不一致                                  | `S3_ENDPOINT` / `S3_REGION` がバケットのものと一致しているか                                                                                                               |
| 絵文字が出ない                                          | `emoji-sync` の実行有無。`EMOJI_S3_BUCKET`。302 に追随できているか                                                                                                         |
| `deploy` が冒頭の `migrate-check` で落ちる               | 未適用マイグレーションがある。`migrate` を先に実行する（想定どおりの挙動）                                                                                                                 |
| `deploy` が `Could not retrieve Project Settings` | `VERCEL_TOKEN` がプロジェクト限定になっていないか。チーム（または Full Account）スコープで再発行して secret を更新する。`.vercel` を消す指示は CI では的外れ（gitignore 済み）。確認は `vercel pull --debug`            |
| `deploy` が `No Output Directory named "public"`  | Vite の出力は `frontend/dist`。`web` サービスに `framework: "vite"` と `outputDirectory: "dist"` が無いと、`vercel pull` がダッシュボードの既定 `public` を使う。500 kB chunk 警告は失敗原因ではない |
| CLI が `projectSettings` エラー                      | `vercel build` 済みなら `vercel deploy --prebuilt --archive=tgz --yes`。`--archive=tgz` 単体は使わない                                                                 |
| `prune-events` が 401                             | Vercel と GitHub secrets の `CRON_SECRET` が同一か                                                                                                               |
| プロジェクトが pause された                                | `ops` の schedule が止まっていないか。Dashboard から restore する                                                                                                         |
| 30 日超オフラインの端末が同期しない                              | 想定どおり。サーバが `resetRequired` を返し、クライアントが全再取得する                                                                                                               |


---



## 13. tasks.md 対応表

`openspec/changes/vercel-supabase-migration/tasks.md` の未完了タスクと本書の対応。


| task                            | 本書                          |
| ------------------------------- | --------------------------- |
| 1.8 `services` が Hobby で使えるか    | 4.2                         |
| 1.9 プレビューで `/health` と PWA      | 4.3                         |
| 6.4 `fetch` → `blob()` の 302 追随 | 8.1                         |
| 8.3 CI の生成物ドリフト検出               | （PR で `ci` workflow が実行される） |
| 11.2 パッケージ済み Electron の実機確認     | 8.3                         |
| 12.2 `/v1/*` の 404 が API エラー    | 8.3                         |
| 12.5 Vercel の環境変数登録             | 4.4                         |
| 13.1 本番昇格                       | 7                           |
| 13.2 DNS 切替                     | 7                           |
| 13.3 3 クライアントの機能確認              | 8.1                         |
| 13.4 ポーリング退避の確認                 | 8.2                         |
| 13.5 定期実行と pause の観察            | 9                           |
| 14.5 AWS / 旧 VPS の破棄            | 9                           |


