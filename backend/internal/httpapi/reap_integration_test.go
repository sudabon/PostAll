package httpapi_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/sudabon/PostAll/backend/internal/blob"
	"github.com/sudabon/PostAll/backend/internal/httpapi"
	"github.com/sudabon/PostAll/backend/internal/testutil"
)

func TestReapEndpointRequiresSharedSecret(t *testing.T) {
	databaseURL := testutil.PostgresURL(t)
	h, err := httpapi.New(httpapi.Config{
		DatabaseURL: databaseURL,
		SupabaseURL: "http://127.0.0.1:1",
		CronSecret:  "reaper-secret",
		Blob:        blob.NewMemory(),
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(h.Close)

	unauth := httptest.NewRequest(http.MethodPost, "/internal/attachments/reap", nil)
	unauthRec := httptest.NewRecorder()
	h.ServeHTTP(unauthRec, unauth)
	if unauthRec.Code != http.StatusUnauthorized {
		t.Fatalf("unauth reap=%d", unauthRec.Code)
	}

	wrong := httptest.NewRequest(http.MethodPost, "/internal/attachments/reap", nil)
	wrong.Header.Set("Authorization", "Bearer other")
	wrongRec := httptest.NewRecorder()
	h.ServeHTTP(wrongRec, wrong)
	if wrongRec.Code != http.StatusUnauthorized {
		t.Fatalf("wrong secret=%d", wrongRec.Code)
	}

	ok := httptest.NewRequest(http.MethodPost, "/internal/attachments/reap", nil)
	ok.Header.Set("Authorization", "Bearer reaper-secret")
	okRec := httptest.NewRecorder()
	h.ServeHTTP(okRec, ok)
	if okRec.Code != http.StatusNoContent {
		t.Fatalf("reap=%d %s", okRec.Code, okRec.Body.String())
	}
}

// Vercel Cron は GET で叩く。POST 限定だと日次の回収が 405 で無言に止まる。
func TestReapEndpointAcceptsGETForVercelCron(t *testing.T) {
	databaseURL := testutil.PostgresURL(t)
	h, err := httpapi.New(httpapi.Config{
		DatabaseURL: databaseURL,
		SupabaseURL: "http://127.0.0.1:1",
		CronSecret:  "reaper-secret",
		Blob:        blob.NewMemory(),
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(h.Close)

	req := httptest.NewRequest(http.MethodGet, "/internal/attachments/reap", nil)
	req.Header.Set("Authorization", "Bearer reaper-secret")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("GET reap=%d %s", rec.Code, rec.Body.String())
	}
}

func TestReapEndpointDeletesPendingAttachments(t *testing.T) {
	databaseURL := testutil.PostgresURL(t)
	mem := blob.NewMemory()
	h, err := httpapi.New(httpapi.Config{
		DatabaseURL: databaseURL,
		SupabaseURL: "http://127.0.0.1:1",
		CronSecret:  "reaper-secret",
		Blob:        mem,
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

	userID := uuid.New()
	attachmentID := uuid.New()
	storageKey := "attachments/pending-reap"
	if _, err := pool.Exec(ctx, `insert into users (id, auth_subject) values ($1, $2)`, userID, "reap-endpoint-user"); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `
		insert into attachments (
			id, uploader_id, file_name, content_type, size_bytes, storage_key,
			checksum, created_at
		) values ($1, $2, 'stale.txt', 'text/plain', 4, $3, 'sum', $4)`,
		attachmentID, userID, storageKey, time.Now().Add(-2*time.Hour)); err != nil {
		t.Fatal(err)
	}
	mem.PutObject(storageKey, []byte("data"))

	req := httptest.NewRequest(http.MethodPost, "/internal/attachments/reap", nil)
	req.Header.Set("Authorization", "Bearer reaper-secret")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("reap=%d %s", rec.Code, rec.Body.String())
	}
	if mem.Has(storageKey) {
		t.Fatal("pending object should be deleted")
	}
	var rows int
	if err := pool.QueryRow(ctx, `select count(*) from attachments where id = $1`, attachmentID).Scan(&rows); err != nil {
		t.Fatal(err)
	}
	if rows != 0 {
		t.Fatalf("attachment rows=%d, want 0", rows)
	}
}

func TestReapEndpointRejectsEmptyCronSecret(t *testing.T) {
	databaseURL := testutil.PostgresURL(t)
	h, err := httpapi.New(httpapi.Config{
		DatabaseURL: databaseURL,
		SupabaseURL: "http://127.0.0.1:1",
		CronSecret:  "",
		Blob:        blob.NewMemory(),
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(h.Close)

	req := httptest.NewRequest(http.MethodPost, "/internal/attachments/reap", nil)
	req.Header.Set("Authorization", "Bearer ")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("empty cron secret reap=%d %s", rec.Code, rec.Body.String())
	}
}
