FLUTTER ?= flutter
DART ?= dart
MERMAID_SRC ?= ../frontend/node_modules/mermaid/dist/mermaid.min.js
MERMAID_DST := assets/mermaid/mermaid.min.js

.PHONY: generate assets test analyze

# api/openapi.yaml から Dart の型を生成する。
# 1. swagger_parser が読める形へ正規化（パス項目レベルの parameters を畳み込む）
# 2. モデルを生成し、REST クライアントの生成物は捨てる（手書きの client を使う）
# 3. json_serializable の .g.dart を生成する
generate:
	$(DART) run tool/prepare_openapi.dart
	$(DART) run swagger_parser
	find lib/api/generated -mindepth 1 -maxdepth 1 ! -name models -exec rm -rf {} +
	$(DART) run tool/write_models_barrel.dart
	$(DART) run build_runner build --delete-conflicting-outputs

# Mermaid は React 側と同じバンドルを WebView に載せる（design.md D10）。
assets:
	@test -f $(MERMAID_SRC) || { echo "$(MERMAID_SRC) がありません。先に cd ../frontend && npm install を実行してください"; exit 1; }
	@mkdir -p $(dir $(MERMAID_DST))
	cp $(MERMAID_SRC) $(MERMAID_DST)

test:
	$(FLUTTER) test

analyze:
	$(FLUTTER) analyze
