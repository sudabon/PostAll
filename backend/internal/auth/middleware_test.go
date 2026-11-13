package auth

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
)

type memoryUsers struct {
	mu    sync.Mutex
	bySub map[string]string
	calls int
}

func (m *memoryUsers) ResolveByAuthSubject(_ context.Context, sub string) (string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.calls++
	if m.bySub == nil {
		m.bySub = map[string]string{}
	}
	if id, ok := m.bySub[sub]; ok {
		return id, nil
	}
	id := sub + "-user"
	m.bySub[sub] = id
	return id, nil
}

func TestMiddlewareRejectsMissingToken(t *testing.T) {
	v := NewVerifierFromURL("http://127.0.0.1:1/jwks", "https://issuer.example", "authenticated", nil)
	h := Middleware(v, &memoryUsers{}, NewAllowedSubjects())(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))
	req := httptest.NewRequest(http.MethodGet, "/v1/channels", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status=%d", rec.Code)
	}
	var body map[string]string
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	if body["code"] != "unauthorized" {
		t.Fatalf("code=%q", body["code"])
	}
}

func TestMiddlewareSkipsHealth(t *testing.T) {
	h := Middleware(nil, nil, NewAllowedSubjects())(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"status":"ok"}`))
	}))
	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d", rec.Code)
	}
}

func newAllowlistTestHandler(t *testing.T, users *memoryUsers, allowed AllowedSubjects) (http.Handler, func(sub string) string) {
	t.Helper()
	key, jwks, kid := testKey(t)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write(jwks)
	}))
	t.Cleanup(srv.Close)
	v := NewVerifierFromURL(srv.URL, "https://issuer.example", "authenticated", srv.Client())
	h := Middleware(v, users, allowed)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p, ok := PrincipalFrom(r.Context())
		if !ok {
			t.Error("principal missing")
		}
		w.Header().Set("X-User-ID", p.UserID)
		w.WriteHeader(http.StatusNoContent)
	}))
	return h, func(sub string) string { return mint(t, key, kid, validClaims(sub)) }
}

func serveWithToken(h http.Handler, path, token string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodGet, path, nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func assertAccountNotAllowed(t *testing.T, rec *httptest.ResponseRecorder) {
	t.Helper()
	if rec.Code != http.StatusForbidden {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
	var body map[string]string
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	if body["code"] != "account_not_allowed" {
		t.Fatalf("code=%q", body["code"])
	}
	if body["message"] == "" {
		t.Fatal("message is empty")
	}
}

func TestMiddlewareAllowsListedSubject(t *testing.T) {
	users := &memoryUsers{}
	h, token := newAllowlistTestHandler(t, users, NewAllowedSubjects(allowedSubA))
	rec := serveWithToken(h, "/v1/channels", token(allowedSubA))
	if rec.Code != http.StatusNoContent {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
	if got := rec.Header().Get("X-User-ID"); got != allowedSubA+"-user" {
		t.Fatalf("user id=%q", got)
	}
	if users.calls != 1 {
		t.Fatalf("ResolveByAuthSubject calls=%d, want 1", users.calls)
	}
}

func TestMiddlewareRejectsUnlistedSubjectBeforeResolvingUser(t *testing.T) {
	users := &memoryUsers{}
	h, token := newAllowlistTestHandler(t, users, NewAllowedSubjects(allowedSubA))
	assertAccountNotAllowed(t, serveWithToken(h, "/v1/channels", token(allowedSubB)))
	if users.calls != 0 {
		t.Fatalf("ResolveByAuthSubject calls=%d, want 0", users.calls)
	}
}

func TestMiddlewareEmptyAllowlistRejectsEveryone(t *testing.T) {
	users := &memoryUsers{}
	h, token := newAllowlistTestHandler(t, users, ParseAllowedSubjects(""))
	for _, sub := range []string{allowedSubA, allowedSubB} {
		assertAccountNotAllowed(t, serveWithToken(h, "/v1/posts/x/thread", token(sub)))
	}
	if users.calls != 0 {
		t.Fatalf("ResolveByAuthSubject calls=%d, want 0", users.calls)
	}
}

func TestMiddlewareSkipAuthPathsIgnoreAllowlist(t *testing.T) {
	for _, path := range []string{"/health", "/ready", "/internal/attachments/reap", "/internal/events/prune"} {
		t.Run(path, func(t *testing.T) {
			users := &memoryUsers{}
			h := Middleware(nil, users, NewAllowedSubjects())(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(http.StatusOK)
			}))
			rec := httptest.NewRecorder()
			h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, nil))
			if rec.Code != http.StatusOK {
				t.Fatalf("status=%d", rec.Code)
			}
			if users.calls != 0 {
				t.Fatalf("ResolveByAuthSubject calls=%d", users.calls)
			}
		})
	}
}

func TestMiddlewareInvalidTokenIsStillUnauthorized(t *testing.T) {
	h, _ := newAllowlistTestHandler(t, &memoryUsers{}, NewAllowedSubjects(allowedSubA))
	rec := serveWithToken(h, "/v1/channels", "not-a-jwt")
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status=%d, want 401 before the allowlist check", rec.Code)
	}
}
