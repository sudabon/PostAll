package httpapi_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/sudabon/PostAll/backend/internal/auth"
	"github.com/sudabon/PostAll/backend/internal/blob"
	"github.com/sudabon/PostAll/backend/internal/httpapi"
	"github.com/sudabon/PostAll/backend/internal/testutil"
)

const (
	allowedSub = "0a3d2c1b-1111-4111-8111-000000000001"
	strangeSub = "0a3d2c1b-2222-4222-8222-000000000002"
	cronSecret = "allowlist-cron-secret"
)

type allowlistEnv struct {
	databaseURL string
	pool        *pgxpool.Pool
	verifier    *auth.Verifier
	token       func(sub string) string
}

func newAllowlistEnv(t *testing.T) allowlistEnv {
	t.Helper()
	databaseURL := testutil.PostgresURL(t)
	key, jwks, kid := testRSA(t)
	jwksSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write(jwks)
	}))
	t.Cleanup(jwksSrv.Close)
	pool, err := pgxpool.New(context.Background(), databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	return allowlistEnv{
		databaseURL: databaseURL,
		pool:        pool,
		verifier:    auth.NewVerifierFromURL(jwksSrv.URL, "https://issuer.example", "authenticated", jwksSrv.Client()),
		token:       func(sub string) string { return "Bearer " + mint(t, key, kid, sub) },
	}
}

func (e allowlistEnv) server(t *testing.T, allowed ...string) *httpapi.Server {
	t.Helper()
	h, err := httpapi.New(httpapi.Config{
		DatabaseURL:         e.databaseURL,
		Verifier:            e.verifier,
		CronSecret:          cronSecret,
		Blob:                blob.NewMemory(),
		AllowedAuthSubjects: allowed,
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(h.Close)
	return h
}

func (e allowlistEnv) countUsers(t *testing.T, sub string) (forSub, total int) {
	t.Helper()
	ctx := context.Background()
	if err := e.pool.QueryRow(ctx, `select count(*) from users where auth_subject = $1`, sub).Scan(&forSub); err != nil {
		t.Fatal(err)
	}
	if err := e.pool.QueryRow(ctx, `select count(*) from users`).Scan(&total); err != nil {
		t.Fatal(err)
	}
	return forSub, total
}

func assertAccountNotAllowed(t *testing.T, res httpResult) {
	t.Helper()
	if res.Code != http.StatusForbidden {
		t.Fatalf("status=%d (want 403, distinct from 401) body=%s", res.Code, res.Body)
	}
	assertErrorCode(t, res.Body, "account_not_allowed")
}

func TestAllowlistRejectsValidTokenOutsideListWithoutCreatingUser(t *testing.T) {
	env := newAllowlistEnv(t)
	h := env.server(t, allowedSub)

	ok := doJSON(t, h, http.MethodGet, "/v1/channels", env.token(allowedSub), nil)
	if ok.Code != http.StatusOK {
		t.Fatalf("allowed subject status=%d body=%s", ok.Code, ok.Body)
	}
	channel := createChannel(t, h, env.token(allowedSub), map[string]any{"name": "secret"})
	_, totalBefore := env.countUsers(t, strangeSub)

	stranger := env.token(strangeSub)
	for _, req := range []struct{ method, path string }{
		{http.MethodGet, "/v1/channels"},
		{http.MethodPost, "/v1/channels"},
		{http.MethodGet, "/v1/channels/" + channel.Id.String() + "/posts"},
		{http.MethodGet, "/v1/search?q=secret"},
		{http.MethodGet, "/v1/events"},
		{http.MethodGet, "/v1/emojis"},
	} {
		var body map[string]any
		if req.method == http.MethodPost {
			body = map[string]any{"name": "intruder"}
		}
		assertAccountNotAllowed(t, doJSON(t, h, req.method, req.path, stranger, body))
	}

	forSub, totalAfter := env.countUsers(t, strangeSub)
	if forSub != 0 {
		t.Fatalf("users rows for rejected subject=%d, want 0", forSub)
	}
	if totalAfter != totalBefore {
		t.Fatalf("users rows changed %d -> %d", totalBefore, totalAfter)
	}
	var channels int
	if err := env.pool.QueryRow(context.Background(), `select count(*) from channels where name = 'intruder'`).Scan(&channels); err != nil {
		t.Fatal(err)
	}
	if channels != 0 {
		t.Fatal("rejected subject created a channel")
	}
}

func TestAllowlistEmptyRejectsEveryoneButKeepsUnauthenticatedRoutes(t *testing.T) {
	env := newAllowlistEnv(t)
	h := env.server(t)

	for _, sub := range []string{allowedSub, strangeSub} {
		assertAccountNotAllowed(t, doJSON(t, h, http.MethodGet, "/v1/channels", env.token(sub), nil))
		assertAccountNotAllowed(t, doJSON(t, h, http.MethodPost, "/v1/channels", env.token(sub), map[string]any{"name": "x"}))
	}
	if _, total := env.countUsers(t, allowedSub); total != 0 {
		t.Fatalf("users rows=%d, want 0", total)
	}

	missing := doJSON(t, h, http.MethodGet, "/v1/channels", "", nil)
	if missing.Code != http.StatusUnauthorized {
		t.Fatalf("missing token status=%d, want 401", missing.Code)
	}

	for _, path := range []string{"/health", "/ready"} {
		res := doJSON(t, h, http.MethodGet, path, "", nil)
		if res.Code != http.StatusOK {
			t.Fatalf("%s status=%d body=%s", path, res.Code, res.Body)
		}
	}
	for _, path := range []string{"/internal/attachments/reap", "/internal/events/prune"} {
		res := doJSON(t, h, http.MethodPost, path, "Bearer "+cronSecret, nil)
		if res.Code != http.StatusNoContent {
			t.Fatalf("%s with CRON_SECRET status=%d body=%s", path, res.Code, res.Body)
		}
		res = doJSON(t, h, http.MethodPost, path, "", nil)
		if res.Code != http.StatusUnauthorized {
			t.Fatalf("%s without CRON_SECRET status=%d", path, res.Code)
		}
	}
}

func TestAllowlistRemovedSubjectIsRejectedDespiteExistingUser(t *testing.T) {
	env := newAllowlistEnv(t)
	before := env.server(t, allowedSub)
	if res := doJSON(t, before, http.MethodGet, "/v1/channels", env.token(allowedSub), nil); res.Code != http.StatusOK {
		t.Fatalf("initial status=%d body=%s", res.Code, res.Body)
	}
	if forSub, _ := env.countUsers(t, allowedSub); forSub != 1 {
		t.Fatalf("users rows for subject=%d, want 1", forSub)
	}

	after := env.server(t, strangeSub)
	assertAccountNotAllowed(t, doJSON(t, after, http.MethodGet, "/v1/channels", env.token(allowedSub), nil))
	if forSub, _ := env.countUsers(t, allowedSub); forSub != 1 {
		t.Fatalf("existing users row should be kept, got %d", forSub)
	}
}
