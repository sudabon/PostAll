package search_test

import (
	"context"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/sudabon/PostAll/backend/internal/search"
	"github.com/sudabon/PostAll/backend/internal/store"
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
		`select extname from pg_extension where extname = 'pgroonga'`,
	).Scan(&extension); err != nil {
		t.Fatal(err)
	}
	if extension != "pgroonga" {
		t.Fatalf("extension=%q want pgroonga", extension)
	}

	var indexDefinition string
	if err := pool.QueryRow(
		context.Background(),
		`select indexdef from pg_indexes where indexname = 'posts_body_pgroonga'`,
	).Scan(&indexDefinition); err != nil {
		t.Fatal(err)
	}
	if indexDefinition == "" {
		t.Fatal("posts_body_pgroonga index definition is empty")
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

func TestSearchMatchesJapaneseSubstringAndLiterals(t *testing.T) {
	databaseURL := testutil.PostgresURL(t)
	pool, err := pgxpool.New(context.Background(), databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)

	ctx := context.Background()
	var userID, channelID string
	if err := pool.QueryRow(ctx, `insert into users (auth_subject) values ('search-user') returning id`).Scan(&userID); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx, `insert into channels (name, sort_key) values ('search', 'a') returning id`).Scan(&channelID); err != nil {
		t.Fatal(err)
	}

	bodies := []string{
		"東京都庁の案内",
		"Hello WORLD",
		"100%_complete",
		"無関係な本文",
	}
	for _, body := range bodies {
		if _, err := pool.Exec(ctx, `insert into posts (channel_id, author_id, body) values ($1, $2, $3)`, channelID, userID, body); err != nil {
			t.Fatal(err)
		}
	}

	svc := search.NewService(store.New(pool))
	assertIDs := func(t *testing.T, query string, want int) {
		t.Helper()
		page, err := svc.Search(ctx, search.Input{Query: query, Limit: 20})
		if err != nil {
			t.Fatal(err)
		}
		if len(page.Results) != want {
			t.Fatalf("q=%q got %d want %d bodies=%v", query, len(page.Results), want, bodiesOf(page.Results))
		}
	}

	assertIDs(t, "都庁", 1)    // 日本語 2 文字・語の途中
	assertIDs(t, "hello", 1) // 大文字小文字非依存
	assertIDs(t, "WORLD", 1)
	assertIDs(t, "100%", 1) // 特殊文字はリテラル
	assertIDs(t, "complete", 1)
	assertIDs(t, "xyz", 0)
}

func TestPGroongaIndexMatchesPlainLike(t *testing.T) {
	databaseURL := testutil.PostgresURL(t)
	pool, err := pgxpool.New(context.Background(), databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)

	ctx := context.Background()
	var userID, channelID string
	if err := pool.QueryRow(ctx, `insert into users (auth_subject) values ('like-user') returning id`).Scan(&userID); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx, `insert into channels (name, sort_key) values ('like', 'a') returning id`).Scan(&channelID); err != nil {
		t.Fatal(err)
	}
	for _, body := range []string{"東京都庁", "hello WORLD", "a%b_c\\d", "別件"} {
		if _, err := pool.Exec(ctx, `insert into posts (channel_id, author_id, body) values ($1, $2, $3)`, channelID, userID, body); err != nil {
			t.Fatal(err)
		}
	}

	conn, err := pool.Acquire(ctx)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(conn.Release)
	t.Cleanup(func() {
		_, _ = conn.Exec(ctx, `create index if not exists posts_body_pgroonga on posts using pgroonga (body pgroonga_text_regexp_ops_v2)`)
	})

	queries := []string{"都庁", "hello", "a%b", "b_c", `c\d`}
	searchBodies := func(pattern string) []string {
		t.Helper()
		rows, err := conn.Query(ctx, `
			select body
			from posts
			where deleted_at is null and body ilike $1 escape '\'
			order by body
		`, pattern)
		if err != nil {
			t.Fatal(err)
		}
		defer rows.Close()
		var bodies []string
		for rows.Next() {
			var body string
			if err := rows.Scan(&body); err != nil {
				t.Fatal(err)
			}
			bodies = append(bodies, body)
		}
		if err := rows.Err(); err != nil {
			t.Fatal(err)
		}
		return bodies
	}
	queryPlan := func(pattern string) string {
		t.Helper()
		rows, err := conn.Query(ctx, `
			explain (format text)
			select body
			from posts
			where deleted_at is null and body ilike $1 escape '\'
		`, pattern)
		if err != nil {
			t.Fatal(err)
		}
		defer rows.Close()
		var lines []string
		for rows.Next() {
			var line string
			if err := rows.Scan(&line); err != nil {
				t.Fatal(err)
			}
			lines = append(lines, line)
		}
		if err := rows.Err(); err != nil {
			t.Fatal(err)
		}
		return strings.Join(lines, "\n")
	}
	for _, q := range queries {
		pattern := search.ContainsPattern(q)
		if _, err := conn.Exec(ctx, `set enable_seqscan = off`); err != nil {
			t.Fatal(err)
		}
		plan := queryPlan(pattern)
		if !strings.Contains(plan, "posts_body_pgroonga") {
			t.Fatalf("q=%q did not use posts_body_pgroonga:\n%s", q, plan)
		}
		withIndex := searchBodies(pattern)
		if _, err := conn.Exec(ctx, `drop index posts_body_pgroonga`); err != nil {
			t.Fatal(err)
		}
		if _, err := conn.Exec(ctx, `reset enable_seqscan`); err != nil {
			t.Fatal(err)
		}
		withoutIndex := searchBodies(pattern)
		if len(withIndex) != len(withoutIndex) {
			t.Fatalf("q=%q indexed=%v plain=%v", q, withIndex, withoutIndex)
		}
		for i := range withIndex {
			if withIndex[i] != withoutIndex[i] {
				t.Fatalf("q=%q indexed=%v plain=%v", q, withIndex, withoutIndex)
			}
		}
		if _, err := conn.Exec(ctx, `create index posts_body_pgroonga on posts using pgroonga (body pgroonga_text_regexp_ops_v2)`); err != nil {
			t.Fatal(err)
		}
	}
}

func bodiesOf(results []search.Result) []string {
	out := make([]string, 0, len(results))
	for _, r := range results {
		out = append(out, r.Body)
	}
	return out
}
