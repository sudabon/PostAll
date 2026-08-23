# PostAll

Slack 風のポスト型メモ管理アプリケーション。チャネルへ放り込むだけで時系列に積み上がり、後から階層で束ね直せる。

macOS（Electron）、ブラウザ（PWA）、iOS（Flutter）の 3 経路から、同じ Go API / PostgreSQL を参照する。

## リポジトリ構成

```
PostAll/
├── api/          # OpenAPI 仕様（3 クライアント共通の契約）
├── backend/      # Go HTTP API
├── frontend/     # React + Vite + Tailwind + shadcn/ui（Electron と PWA の共通コード）
├── electron/     # Electron メインプロセスとパッケージング
├── mobile/       # Flutter（iOS）
├── emoji/        # カスタム絵文字 png
├── infra/        # Compose / Nginx / Certbot / PostgreSQL イメージ
└── openspec/     # 仕様と change
```

## 前提

- Go 1.25+
- Node.js 22+
- Flutter（iOS シミュレータまたは実機）
- Docker / Docker Compose
- 本番: 単一 VPS、ドメイン `memo.sudabon.com`、AWS アカウント（Cognito / S3、手動構築）

## ローカル起動

```bash
# フロントエンド
cd frontend && npm install && npm run dev

# API（DATABASE_URL 未設定なら /health は DB をスキップ）
cd backend && go run ./cmd/postall-server

# iOS（接続先は --dart-define で渡す）
cd mobile
# assets/mermaid/mermaid.min.js はリポジトリに入っている。
# 更新するときだけ `make assets`（frontend/node_modules から取り込む）。
flutter run -d iphone \
  --dart-define=POSTALL_API_BASE_URL=https://memo.sudabon.com \
  --dart-define=POSTALL_COGNITO_DOMAIN=<cognito-domain> \
  --dart-define=POSTALL_COGNITO_CLIENT_ID=<client-id>

# 4 コンテナ（Nginx / API / PostgreSQL。Certbot は tls プロファイル）
./infra/certs/generate-dev-certs.sh
cd frontend && npm run build
cd ../infra && docker compose up --build
```

HTTPS は自己署名証明書で `https://localhost` に応答する。本番（`memo.sudabon.com`）の Let's Encrypt 取得:

```bash
cd infra
cp .env.example .env
# CERTBOT_EMAIL を編集
docker compose --env-file .env --profile tls run --rm --entrypoint /usr/local/bin/obtain.sh certbot
docker compose --env-file .env --profile tls up -d certbot
```

証明書更新後は Certbot の deploy hook が Nginx の読むファイルを差し替え、Nginx コンテナが inotify でリロードする。

## AWS リソース

Cognito ユーザープールと添付用 S3 バケットは AWS コンソール（または CLI）で手動作成する。バケットはパブリック読み取り禁止。クライアントは署名付き URL 経由でのみアクセスする。

| 項目 | 値 |
|---|---|
| リージョン | `ap-northeast-1` |
| User Pool ID | `ap-northeast-1_xogm4iId4` |
| App Client ID | `5ouammtqkvidc60e5c260r1n8m` |
| S3 バケット | `postall-attachment-files-472750886047` |

コールバック URI:

| クライアント | リダイレクト URI |
|---|---|
| PWA | `https://memo.sudabon.com/auth/callback` |
| Electron / iOS | `postall://auth/callback` |

## 開発コマンド

```bash
make test
make lint
make generate   # OpenAPI からのコード生成。CI で git diff --exit-code する
```

`make generate` は backend（oapi-codegen）と mobile（swagger_parser + build_runner）の
両方を回す。mobile 側は `api/openapi.yaml` を正規化した中間 JSON から
`mobile/lib/api/generated/models/` を作り、REST クライアントは手書きの
`mobile/lib/api/http_postall_api.dart` を使う。

## 運用メモ

- PostgreSQL は自前コンテナ（`pg_bigm` 入り）。RDS / Aurora は使わない。
- 絵文字カタログはデプロイ時に `docker compose -f infra/docker-compose.yml run --rm api emoji-sync` を実行する（起動時の自動走査はしない）。ローカル実行時は `cd backend && DATABASE_URL=... go run ./cmd/postall-server emoji-sync` を使う。
- API と PostgreSQL のポートは Compose 上で公開しない。公開エンドポイントは Nginx の 80/443 のみ。
- iOS の Mermaid 描画は WebView に `mermaid.min.js` を載せる。React 側と同じバンドルを使うため、
  `frontend` の依存を入れたうえで `make -C mobile assets` を実行してから iOS をビルドする。
- iOS の接続設定は `--dart-define` の既定値をアプリ内の「接続設定」から上書きできる。
  トークンは Keychain に保管する。
