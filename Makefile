.PHONY: test lint generate typecheck supabase-up supabase-down

SUPABASE_FILTER := label=com.supabase.cli.project=PostAll
SUPABASE_DB := supabase_db_PostAll

test:
	cd backend && go test ./...
	cd frontend && npm test

lint:
	cd backend && go vet ./...
	cd frontend && npm run lint

typecheck:
	cd frontend && npm run typecheck

generate:
	@if [ -f api/openapi.yaml ]; then \
		$(MAKE) -C backend generate; \
	else \
		echo "api/openapi.yaml は未作成"; \
		exit 1; \
	fi

# supabase start は停止中のコンテナが残っていると失敗し、新規作成時は
# unless-stopped を付けて Docker 起動時に自動起動させるため、ここで吸収する。
supabase-up:
	@set -e; \
	if [ -z "$$(docker ps -aq --filter $(SUPABASE_FILTER))" ]; then \
		supabase start; \
	else \
		docker start $(SUPABASE_DB) >/dev/null; \
		for i in $$(seq 1 60); do \
			[ "$$(docker inspect --format '{{.State.Health.Status}}' $(SUPABASE_DB))" = healthy ] && break; \
			[ "$$i" = 60 ] && { echo "$(SUPABASE_DB) が healthy になりません"; exit 1; }; \
			sleep 1; \
		done; \
		stopped="$$(docker ps -aq --filter $(SUPABASE_FILTER) --filter status=exited)"; \
		[ -z "$$stopped" ] || docker start $$stopped >/dev/null; \
	fi; \
	docker update --restart=no $$(docker ps -aq --filter $(SUPABASE_FILTER)) >/dev/null; \
	supabase status

supabase-down:
	@running="$$(docker ps -q --filter $(SUPABASE_FILTER))"; \
	[ -z "$$running" ] || docker stop $$running >/dev/null
