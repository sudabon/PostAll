package store_test

import (
	"context"
	"sync"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/sudabon/PostAll/backend/internal/store"
	"github.com/sudabon/PostAll/backend/internal/testutil"
)

func TestResolveByAuthSubjectConcurrentInserts(t *testing.T) {
	databaseURL := testutil.PostgresURL(t)
	pool, err := pgxpool.New(context.Background(), databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)

	st := store.NewStore(pool)
	const n = 10
	ids := make([]string, n)
	errs := make([]error, n)
	var wg sync.WaitGroup
	wg.Add(n)
	for i := range n {
		go func(i int) {
			defer wg.Done()
			id, err := st.ResolveByAuthSubject(context.Background(), "concurrent-subject")
			ids[i] = id
			errs[i] = err
		}(i)
	}
	wg.Wait()

	var first string
	for i, err := range errs {
		if err != nil {
			t.Fatalf("goroutine %d: %v", i, err)
		}
		if ids[i] == "" {
			t.Fatalf("goroutine %d returned empty id", i)
		}
		if first == "" {
			first = ids[i]
		} else if ids[i] != first {
			t.Fatalf("id mismatch %s vs %s", first, ids[i])
		}
	}

	var rows int
	if err := pool.QueryRow(context.Background(), `select count(*) from users where auth_subject = 'concurrent-subject'`).Scan(&rows); err != nil {
		t.Fatal(err)
	}
	if rows != 1 {
		t.Fatalf("users rows=%d, want 1", rows)
	}
}
