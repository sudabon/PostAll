package httpapi_test

import (
	"context"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/sudabon/PostAll/backend/internal/store"
	"github.com/sudabon/PostAll/backend/internal/testutil"
)

func TestTransactionPoolerCompatibleQueryExecMode(t *testing.T) {
	databaseURL := testutil.PostgresURL(t)
	cfg, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	cfg.MaxConns = 2
	cfg.ConnConfig.DefaultQueryExecMode = pgx.QueryExecModeExec
	pool, err := pgxpool.NewWithConfig(context.Background(), cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)

	q := store.New(pool)
	ctx := context.Background()
	first, err := q.InsertUserByAuthSubject(ctx, "pool-user")
	if err != nil {
		t.Fatal(err)
	}
	second, err := q.GetUserByAuthSubject(ctx, "pool-user")
	if err != nil {
		t.Fatal(err)
	}
	if first.ID != second.ID {
		t.Fatalf("id mismatch %s %s", first.ID, second.ID)
	}
	if _, err := q.GetUserByAuthSubject(ctx, "pool-user"); err != nil {
		t.Fatalf("repeat select after reconnect-style exec: %v", err)
	}
}
