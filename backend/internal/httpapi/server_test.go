package httpapi

import (
	"bytes"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/sudabon/PostAll/backend/internal/api"
	"github.com/sudabon/PostAll/backend/internal/channel"
)

func TestHealthWithoutDatabase(t *testing.T) {
	h, err := New(Config{})
	if err != nil {
		t.Fatalf("New: %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}

	var body api.Health
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if body.Status != api.HealthStatusOk {
		t.Fatalf("status = %q, want ok", body.Status)
	}
	if body.Database != api.HealthDatabaseSkipped {
		t.Fatalf("database = %q, want skipped", body.Database)
	}
}

func TestChannelsRequireAuth(t *testing.T) {
	h, err := New(Config{})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	req := httptest.NewRequest(http.MethodGet, "/v1/channels", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status=%d want 401", rec.Code)
	}
	var body api.Error
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	if body.Code != "unauthorized" {
		t.Fatalf("code=%q", body.Code)
	}
}

func TestUnexpectedErrorsAreLoggedWithSafeRequestContext(t *testing.T) {
	var logs bytes.Buffer
	previous := slog.Default()
	slog.SetDefault(slog.New(slog.NewJSONHandler(&logs, nil)))
	t.Cleanup(func() { slog.SetDefault(previous) })

	sentinel := errors.New("sentinel database failure https://storage.example/object?X-Amz-Signature=signed-secret")
	h := requestIDMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		writeAppError(w, r, sentinel)
	}))
	req := httptest.NewRequest(http.MethodGet, "/v1/posts?signature=query-secret", nil)
	req.Header.Set("Authorization", "Bearer header-secret")
	req.Header.Set("X-Request-ID", "80684471-1591-4cb3-b2f7-31faec40c492")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status=%d", rec.Code)
	}
	var body api.Error
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	if body.Code != "internal" || body.Message != "内部エラーが発生しました" {
		t.Fatalf("response=%+v", body)
	}
	if got := rec.Header().Get("X-Request-ID"); got != "80684471-1591-4cb3-b2f7-31faec40c492" {
		t.Fatalf("request id=%q", got)
	}
	logged := logs.String()
	for _, want := range []string{"sentinel database failure", "80684471-1591-4cb3-b2f7-31faec40c492", http.MethodGet, "/v1/posts"} {
		if !strings.Contains(logged, want) {
			t.Fatalf("log %q does not contain %q", logged, want)
		}
	}
	for _, secret := range []string{"query-secret", "header-secret", "signed-secret", "Authorization"} {
		if strings.Contains(logged, secret) {
			t.Fatalf("log contains secret %q: %s", secret, logged)
		}
	}

	logs.Reset()
	typed := requestIDMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		writeAppError(w, r, &channel.Error{Code: "validation", Message: "bad input", Status: http.StatusBadRequest})
	}))
	typed.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodPost, "/v1/channels", nil))
	if logs.Len() != 0 {
		t.Fatalf("typed application error was logged as unexpected: %s", logs.String())
	}
}
