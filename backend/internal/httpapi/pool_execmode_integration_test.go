package httpapi_test

import (
	"context"
	"testing"

	"github.com/google/uuid"
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
	cfg.ConnConfig.DefaultQueryExecMode = pgx.QueryExecModeDescribeExec
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

	ch, err := q.InsertChannel(ctx, store.InsertChannelParams{Name: "pool", SortKey: "a"})
	if err != nil {
		t.Fatal(err)
	}
	post, err := q.InsertPost(ctx, store.InsertPostParams{
		ChannelID: ch.ID, AuthorID: first.ID, Body: "describe-exec",
	})
	if err != nil {
		t.Fatalf("insert post with null thread_root: %v", err)
	}
	if _, err := q.ListReactionRowsForPosts(ctx, []uuid.UUID{post.ID}); err != nil {
		t.Fatalf("list reactions: %v", err)
	}
}
