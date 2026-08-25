# deployment Specification

## Purpose
TBD - created by archiving change slack-style-memo-app. Update Purpose after archive.
## Requirements
### Requirement: コンテナによる構成
システムは、リバースプロキシ（Nginx）、証明書管理（Certbot）、API サーバ、PostgreSQL をコンテナとして構成し、単一の定義から起動できなければならない (SHALL)。

#### Scenario: 構成一式を起動する
- **WHEN** 運用者がデプロイ定義から構成を起動する
- **THEN** システムは Nginx、Certbot、API サーバ、PostgreSQL のコンテナを起動し、API と PWA が HTTPS で応答する状態になる

#### Scenario: API サーバが DB より先に起動する
- **WHEN** PostgreSQL が受付可能になる前に API サーバが起動する
- **THEN** システムは API サーバの接続再試行によって復帰し、手動の再起動を必要としない

#### Scenario: 設定値を環境変数で与える
- **WHEN** 運用者が接続先やシークレットを環境変数で与える
- **THEN** システムはイメージを再ビルドすることなく設定を反映し、シークレットをイメージへ埋め込まない

### Requirement: リバースプロキシによる振り分け
システムは、Nginx を TLS 終端かつ唯一の公開エンドポイントとし、API と PWA の静的アセットへ振り分けなければならない (SHALL)。API サーバと PostgreSQL をインターネットへ直接公開してはならない (MUST NOT)。

#### Scenario: API へ振り分ける
- **WHEN** クライアントが API のパスへ HTTPS で要求する
- **THEN** Nginx は当該要求を API サーバのコンテナへ転送し、応答を返す

#### Scenario: PWA を配信する
- **WHEN** ブラウザがアプリのルート URL へ要求する
- **THEN** Nginx は PWA の静的アセットを配信する

#### Scenario: SPA のルーティングを壊さない
- **WHEN** ブラウザが PWA の任意のパスへ直接アクセスする
- **THEN** Nginx はアプリシェルを返し、404 を返さない

#### Scenario: SSE 接続を維持する
- **WHEN** クライアントが変更通知の SSE エンドポイントへ接続する
- **THEN** Nginx は当該接続をバッファリングせずに中継し、アイドルによる早期切断を起こさない

#### Scenario: バックエンドへ直接到達できない
- **WHEN** インターネット側から API サーバまたは PostgreSQL のポートへ直接接続を試みる
- **THEN** システムは接続を受け付けない

#### Scenario: アップロード要求のサイズ制限
- **WHEN** クライアントが添付に関する要求を送信する
- **THEN** Nginx は添付の上限サイズと矛盾しない要求サイズ制限を適用し、正当な要求を拒否しない

### Requirement: HTTPS の強制
システムは、すべての公開エンドポイントを HTTPS で提供しなければならない (SHALL)。HTTP での要求は HTTPS へリダイレクトされなければならない (SHALL)。

#### Scenario: HTTP でアクセスされる
- **WHEN** クライアントが HTTP でアクセスする
- **THEN** Nginx は同一パスの HTTPS へリダイレクトする

#### Scenario: 証明書検証の取得経路を確保する
- **WHEN** Certbot が証明書の取得・更新のために HTTP の検証用パスへのアクセスを必要とする
- **THEN** Nginx は当該パスのみ HTTPS へのリダイレクトから除外し、検証を成立させる

### Requirement: 証明書の取得と自動更新
システムは、Certbot によって TLS 証明書を取得し、有効期限前に自動で更新しなければならない (SHALL)。更新後、Nginx が新しい証明書を読み込まなければならない (SHALL)。

#### Scenario: 初回の証明書取得
- **WHEN** 運用者が初回のデプロイを行う
- **THEN** システムは対象ドメインの証明書を取得し、HTTPS で応答できる状態にする

#### Scenario: 期限前に自動更新する
- **WHEN** 証明書の有効期限が更新の閾値に達する
- **THEN** Certbot は運用者の操作を要さずに証明書を更新する

#### Scenario: 更新後に反映する
- **WHEN** 証明書が更新される
- **THEN** Nginx は新しい証明書を読み込み、サービスを停止させずに新しい接続へ適用する

#### Scenario: 更新に失敗する
- **WHEN** 証明書の更新が失敗する
- **THEN** システムは失敗を記録し、運用者が検知できる形で残したうえで、既存の証明書での応答を継続する

#### Scenario: 証明書が永続化される
- **WHEN** コンテナが再作成される
- **THEN** システムは取得済みの証明書を失わず、再取得を要さずに HTTPS で応答する

### Requirement: データの永続化
システムは、PostgreSQL のデータと証明書をコンテナのライフサイクルから独立して永続化しなければならない (SHALL)。

#### Scenario: コンテナを再作成する
- **WHEN** 運用者が API サーバまたは PostgreSQL のコンテナを作り直す
- **THEN** システムは既存のチャネル・ポスト・添付メタデータを保持したまま復帰する

### Requirement: マイグレーションの適用
システムは、スキーマのマイグレーションが未適用の状態で稼働してはならない (MUST NOT)。

#### Scenario: 未適用のマイグレーションがある
- **WHEN** 新しいスキーマ版を含む API サーバが未適用の DB に対して起動する
- **THEN** システムは未適用のマイグレーションを適用するか、適用が必要である旨を明示して起動を中止する

### Requirement: ヘルスチェック
システムは、各コンテナの稼働状態を判定できるヘルスチェックを提供しなければならない (SHALL)。

#### Scenario: API サーバの稼働を確認する
- **WHEN** ヘルスチェックが API サーバへ問い合わせる
- **THEN** システムは依存する PostgreSQL への接続可否を含めた稼働状態を返す

#### Scenario: 依存先が落ちている
- **WHEN** PostgreSQL へ接続できない状態でヘルスチェックが実行される
- **THEN** システムは不健全であることを示す応答を返す

### Requirement: `pg_bigm` を含む PostgreSQL
システムは、全文検索に必要な `pg_bigm` 拡張が利用できる PostgreSQL を提供しなければならない (SHALL)。

#### Scenario: 拡張を有効化する
- **WHEN** マイグレーションが `pg_bigm` 拡張の作成を実行する
- **THEN** システムはエラーなく拡張を有効化し、bigram 索引を作成できる状態になる

