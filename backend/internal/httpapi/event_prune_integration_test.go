package httpapi_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/sudabon/PostAll/backend/internal/httpapi"
	"github.com/sudabon/PostAll/backend/internal/testutil"
)

func TestPruneChangeEventsRetainsThirtyDaysAndRequiresSecret(t *testing.T) {
	databaseURL := testutil.PostgresURL(t)
	h, err := httpapi.New(httpapi.Config{
		DatabaseURL: databaseURL,
		SupabaseURL: "http://127.0.0.1:1",
		CronSecret:  "maintenance-secret",
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(h.Close)

	ctx := context.Background()
	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	ages := []time.Duration{
		-31 * 24 * time.Hour,
		-29 * 24 * time.Hour,
		-31 * 24 * time.Hour,
		-29 * 24 * time.Hour,
	}
	for _, age := range ages {
		if _, err := pool.Exec(ctx, `
			insert into change_events (event_type, created_at)
			values ('post.updated', $1)
		`, time.Now().Add(age)); err != nil {
			t.Fatal(err)
		}
	}

	unauthorized := httptest.NewRequest(http.MethodPost, "/internal/events/prune", nil)
	unauthorizedRec := httptest.NewRecorder()
	h.ServeHTTP(unauthorizedRec, unauthorized)
	if unauthorizedRec.Code != http.StatusUnauthorized {
		t.Fatalf("unauthorized prune=%d", unauthorizedRec.Code)
	}

	req := httptest.NewRequest(http.MethodPost, "/internal/events/prune", nil)
	req.Header.Set("Authorization", "Bearer maintenance-secret")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("prune=%d %s", rec.Code, rec.Body.String())
	}

	var count int
	var oldestID, latestID, prunedThrough int64
	if err := pool.QueryRow(ctx, `
		select count(*), coalesce(min(id), 0), coalesce(max(id), 0),
		       (select pruned_through from change_event_retention where singleton)
		from change_events
	`).Scan(&count, &oldestID, &latestID, &prunedThrough); err != nil {
		t.Fatal(err)
	}
	if count != 2 || latestID-oldestID != 2 || prunedThrough != oldestID+1 {
		t.Fatalf("retained count=%d oldest=%d latest=%d prunedThrough=%d", count, oldestID, latestID, prunedThrough)
	}

	// 保持期間内の行が1件もない場合でも、最新 ID は期限判定用の
	// ウォーターマークとして残す。
	if _, err := pool.Exec(ctx, `
		truncate change_events restart identity;
		update change_event_retention set pruned_through = 0 where singleton;
	`); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 3; i++ {
		if _, err := pool.Exec(ctx, `
			insert into change_events (event_type, created_at)
			values ('post.updated', $1)
		`, time.Now().Add(-31*24*time.Hour)); err != nil {
			t.Fatal(err)
		}
	}
	secondReq := httptest.NewRequest(http.MethodGet, "/internal/events/prune", nil)
	secondReq.Header.Set("Authorization", "Bearer maintenance-secret")
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, secondReq)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("second prune=%d %s", rec.Code, rec.Body.String())
	}
	if err := pool.QueryRow(ctx, `
		select count(*), coalesce(min(id), 0), coalesce(max(id), 0),
		       (select pruned_through from change_event_retention where singleton)
		from change_events
	`).Scan(&count, &oldestID, &latestID, &prunedThrough); err != nil {
		t.Fatal(err)
	}
	if count != 1 || oldestID != latestID || prunedThrough != latestID-1 {
		t.Fatalf("watermark count=%d oldest=%d latest=%d prunedThrough=%d", count, oldestID, latestID, prunedThrough)
	}
}
