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
}

func (m *memoryUsers) UpsertByCognitoSub(_ context.Context, sub string) (string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
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
	v := NewVerifierFromURL("http://127.0.0.1:1/jwks", "https://issuer.example", "client-1", nil)
	h := Middleware(v, &memoryUsers{})(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
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
	h := Middleware(nil, nil)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
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
