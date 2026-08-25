.PHONY: generate test vet sqlc

generate:
	go tool oapi-codegen \
		-config oapi-codegen.yaml \
		../api/openapi.yaml

sqlc:
	go tool sqlc generate

test:
	go test ./...

vet:
	go vet ./...
