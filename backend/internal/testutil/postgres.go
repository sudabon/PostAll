package testutil

import (
	"context"
	"path/filepath"
	"runtime"
	"testing"
	"time"

	"github.com/sudabon/PostAll/backend/internal/migrate"
	"github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/modules/postgres"
	"github.com/testcontainers/testcontainers-go/wait"
)

func PostgresURL(t *testing.T) string {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	t.Cleanup(cancel)
	_, sourceFile, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("resolve testutil source path")
	}
	postgresContext := filepath.Clean(filepath.Join(filepath.Dir(sourceFile), "..", "..", "..", "infra", "postgres"))

	ctr, err := postgres.Run(ctx,
		"",
		testcontainers.WithDockerfile(testcontainers.FromDockerfile{
			Context:    postgresContext,
			Dockerfile: "Dockerfile",
			Repo:       "postall-postgres-test",
			Tag:        "16-bigm",
			KeepImage:  true,
		}),
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
