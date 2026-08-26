package testutil

import (
	"context"
	"testing"
	"time"

	"github.com/sudabon/PostAll/backend/internal/migrate"
	"github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/modules/postgres"
	"github.com/testcontainers/testcontainers-go/wait"
)

const pgroongaImage = "groonga/pgroonga:4.0.8-alpine-16"

func PostgresURL(t *testing.T) string {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	t.Cleanup(cancel)

	ctr, err := postgres.Run(ctx,
		pgroongaImage,
		postgres.WithDatabase("postall"),
		postgres.WithUsername("postall"),
		postgres.WithPassword("postall"),
		testcontainers.WithWaitStrategy(
			wait.ForLog("database system is ready to accept connections").
				WithOccurrence(2).
				WithStartupTimeout(time.Minute),
		),
	)
	if err != nil {
		t.Fatalf("postgres container: %v", err)
	}
	t.Cleanup(func() {
		_ = ctr.Terminate(context.Background())
	})

	url, err := ctr.ConnectionString(ctx, "sslmode=disable")
	if err != nil {
		t.Fatal(err)
	}
	if err := migrate.Up(url); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	return url
}
