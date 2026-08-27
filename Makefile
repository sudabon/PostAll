.PHONY: test lint generate typecheck

test:
	cd backend && go test ./...
	cd frontend && npm test
	cd mobile && flutter test

lint:
	cd backend && go vet ./...
	cd frontend && npm run lint
	cd mobile && flutter analyze

typecheck:
	cd frontend && npm run typecheck

generate:
	@if [ -f api/openapi.yaml ]; then \
		$(MAKE) -C backend generate; \
		$(MAKE) -C mobile generate; \
	else \
		echo "api/openapi.yaml は未作成"; \
		exit 1; \
	fi
