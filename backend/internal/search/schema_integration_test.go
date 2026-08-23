package search_test

import (
	"context"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/sudabon/PostAll/backend/internal/testutil"
)

func TestSearchAndEventSchema(t *testing.T) {
	databaseURL := testutil.PostgresURL(t)
	pool, err := pgxpool.New(context.Background(), databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)

	var extension string
	if err := pool.QueryRow(
		context.Background(),
		`select extname from pg_extension where extname = 'pg_bigm'`,
	).Scan(&extension); err != nil {
		t.Fatal(err)
	}
	if extension != "pg_bigm" {
		t.Fatalf("extension=%q want pg_bigm", extension)
	}

	var indexDefinition string
	if err := pool.QueryRow(
		context.Background(),
		`select indexdef from pg_indexes where indexname = 'posts_body_bigm'`,
	).Scan(&indexDefinition); err != nil {
		t.Fatal(err)
	}
	if indexDefinition == "" {
		t.Fatal("posts_body_bigm index definition is empty")
	}

	var eventTable string
	if err := pool.QueryRow(
		context.Background(),
		`select to_regclass('public.change_events')::text`,
	).Scan(&eventTable); err != nil {
		t.Fatal(err)
	}
	if eventTable != "change_events" {
		t.Fatalf("event table=%q want change_events", eventTable)
	}
}
