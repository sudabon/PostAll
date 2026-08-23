package httpapi_test

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/sudabon/PostAll/backend/internal/api"
	"github.com/sudabon/PostAll/backend/internal/attachment"
	"github.com/sudabon/PostAll/backend/internal/auth"
	"github.com/sudabon/PostAll/backend/internal/blob"
	"github.com/sudabon/PostAll/backend/internal/httpapi"
	"github.com/sudabon/PostAll/backend/internal/store"
	"github.com/sudabon/PostAll/backend/internal/testutil"
)

func TestAttachmentsUploadDownloadAndReap(t *testing.T) {
	dbURL := testutil.PostgresURL(t)
	key, jwks, kid := testRSA(t)
	jwksSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write(jwks)
	}))
	t.Cleanup(jwksSrv.Close)

	mem := blob.NewMemory()
	verifier := auth.NewVerifierFromURL(jwksSrv.URL, "https://issuer.example", "client-1", jwksSrv.Client())
	h, err := httpapi.New(httpapi.Config{DatabaseURL: dbURL, Verifier: verifier, Blob: mem})
	if err != nil {
		t.Fatal(err)
	}
	authz := "Bearer " + mint(t, key, kid, "user-sub")

	unauth := doJSON(t, h, http.MethodPost, "/v1/attachments/uploads", "", map[string]any{
		"fileName": "a.png", "contentType": "image/png", "sizeBytes": 4, "checksum": "abcd",
	})
	if unauth.Code != http.StatusUnauthorized {
		t.Fatalf("unauth start=%d %s", unauth.Code, unauth.Body)
	}

	tooBig := doJSON(t, h, http.MethodPost, "/v1/attachments/uploads", authz, map[string]any{
		"fileName": "big.bin", "contentType": "image/png", "sizeBytes": 26 << 20, "checksum": "abcd",
	})
	if tooBig.Code != http.StatusBadRequest {
		t.Fatalf("too big=%d %s", tooBig.Code, tooBig.Body)
	}

	badType := doJSON(t, h, http.MethodPost, "/v1/attachments/uploads", authz, map[string]any{
		"fileName": "x.exe", "contentType": "application/x-msdownload", "sizeBytes": 4, "checksum": "abcd",
	})
	if badType.Code != http.StatusBadRequest {
		t.Fatalf("bad type=%d %s", badType.Code, badType.Body)
	}

	payload := []byte("png!")
	sum := sha256.Sum256(payload)
	start := doJSON(t, h, http.MethodPost, "/v1/attachments/uploads", authz, map[string]any{
		"fileName": "note.png", "contentType": "image/png", "sizeBytes": len(payload), "checksum": hex.EncodeToString(sum[:]),
	})
	if start.Code != http.StatusCreated {
		t.Fatalf("start=%d %s", start.Code, start.Body)
	}
	var started api.StartUploadResponse
	if err := json.Unmarshal(start.Body, &started); err != nil {
		t.Fatal(err)
	}
	if started.UploadUrl == "" {
		t.Fatal("missing upload url")
	}
	mem.PutObject(mem.LastKey, payload)

	complete := doJSON(t, h, http.MethodPost, "/v1/attachments/"+started.Id.String()+"/complete", authz, nil)
	if complete.Code != http.StatusOK {
		t.Fatalf("complete=%d %s", complete.Code, complete.Body)
	}

	ch := createChannel(t, h, authz, map[string]any{"name": "files"})
	created := doJSON(t, h, http.MethodPost, "/v1/channels/"+ch.Id.String()+"/posts", authz, map[string]any{
		"body":          "",
		"attachmentIds": []string{started.Id.String()},
	})
	if created.Code != http.StatusCreated {
		t.Fatalf("create with attachment=%d %s", created.Code, created.Body)
	}
	var post api.Post
	if err := json.Unmarshal(created.Body, &post); err != nil {
		t.Fatal(err)
	}
	if post.Attachments == nil || len(*post.Attachments) != 1 {
		t.Fatalf("attachments=%v", post.Attachments)
	}

	dl := doJSON(t, h, http.MethodGet, "/v1/attachments/"+started.Id.String()+"/download", authz, nil)
	if dl.Code != http.StatusOK {
		t.Fatalf("download=%d %s", dl.Code, dl.Body)
	}

	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dbURL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	st := store.NewStore(pool)
	svc := attachment.NewService(st.Queries, mem)

	stale := doJSON(t, h, http.MethodPost, "/v1/attachments/uploads", authz, map[string]any{
		"fileName": "stale.png", "contentType": "image/png", "sizeBytes": 4, "checksum": hex.EncodeToString(sum[:]),
	})
	if stale.Code != http.StatusCreated {
		t.Fatalf("stale start=%d %s", stale.Code, stale.Body)
	}
	var staleResp api.StartUploadResponse
	if err := json.Unmarshal(stale.Body, &staleResp); err != nil {
		t.Fatal(err)
	}
	mem.PutObject(mem.LastKey, payload)
	if _, err := pool.Exec(ctx, `update attachments set created_at = $1 where id = $2`, time.Now().Add(-2*time.Hour), staleResp.Id); err != nil {
		t.Fatal(err)
	}
	if err := svc.Reap(ctx); err != nil {
		t.Fatal(err)
	}
	if mem.Has(mem.LastKey) {
		t.Fatal("stale object should be deleted")
	}

	del := doJSON(t, h, http.MethodDelete, "/v1/posts/"+post.Id.String(), authz, nil)
	if del.Code != http.StatusNoContent {
		t.Fatalf("delete post=%d %s", del.Code, del.Body)
	}
	liveKey := "keep"
	_ = liveKey
	if err := svc.Reap(ctx); err != nil {
		t.Fatal(err)
	}
	gone := doJSON(t, h, http.MethodGet, "/v1/attachments/"+started.Id.String()+"/download", authz, nil)
	if gone.Code != http.StatusNotFound {
		t.Fatalf("download after delete reap=%d %s", gone.Code, gone.Body)
	}
}
