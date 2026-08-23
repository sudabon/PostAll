package httpapi

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/sudabon/PostAll/backend/internal/api"
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
