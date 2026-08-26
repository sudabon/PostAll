package httpapi_test

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/sudabon/PostAll/backend/internal/httpapi"
	"github.com/sudabon/PostAll/backend/internal/testutil"
)

func TestReapEndpointRequiresSharedSecret(t *testing.T) {
	databaseURL := testutil.PostgresURL(t)
	h, err := httpapi.New(httpapi.Config{DatabaseURL: databaseURL, CronSecret: "reaper-secret"})
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
