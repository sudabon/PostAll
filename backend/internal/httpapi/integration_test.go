package httpapi_test

import (
	"bytes"
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/sudabon/PostAll/backend/internal/api"
	"github.com/sudabon/PostAll/backend/internal/auth"
	"github.com/sudabon/PostAll/backend/internal/httpapi"
	"github.com/sudabon/PostAll/backend/internal/testutil"
)

func TestAuthenticationAndChannelHierarchy(t *testing.T) {
	url := testutil.PostgresURL(t)
	key, jwks, kid := testRSA(t)
	jwksHits := 0
	jwksSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		jwksHits++
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write(jwks)
	}))
	t.Cleanup(jwksSrv.Close)

	verifier := auth.NewVerifierFromURL(jwksSrv.URL, "https://issuer.example", "authenticated", jwksSrv.Client())
	h, err := httpapi.New(httpapi.Config{DatabaseURL: url, Verifier: verifier})
	if err != nil {
		t.Fatal(err)
	}

	token := mint(t, key, kid, "user-sub")
	authz := "Bearer " + token

	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("health=%d", rec.Code)
	}

	req = httptest.NewRequest(http.MethodGet, "/v1/channels", nil)
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("unauth list=%d", rec.Code)
	}

	bad := mintClaims(t, key, kid, jwt.MapClaims{
		"iss": "https://other.example", "sub": "user-sub", "aud": "authenticated",
		"role": "authenticated", "exp": time.Now().Add(time.Hour).Unix(), "iat": time.Now().Unix(),
	})
	req = httptest.NewRequest(http.MethodGet, "/v1/channels", nil)
	req.Header.Set("Authorization", "Bearer "+bad)
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("wrong iss=%d", rec.Code)
	}

	expired := mintClaims(t, key, kid, jwt.MapClaims{
		"iss": "https://issuer.example", "sub": "user-sub", "aud": "authenticated",
		"role": "authenticated", "exp": time.Now().Add(-time.Hour).Unix(), "iat": time.Now().Add(-2 * time.Hour).Unix(),
	})
	req = httptest.NewRequest(http.MethodGet, "/v1/channels", nil)
	req.Header.Set("Authorization", "Bearer "+expired)
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expired=%d", rec.Code)
	}

	root := createChannel(t, h, authz, map[string]any{"name": "root"})
	if root.ParentId != nil {
		t.Fatal("root should have null parent")
	}
	conflict := doJSON(t, h, http.MethodPost, "/v1/channels", authz, map[string]any{"name": "root"})
	if conflict.Code != http.StatusConflict {
		t.Fatalf("name conflict status=%d body=%s", conflict.Code, conflict.Body)
	}
	assertErrorCode(t, conflict.Body, "name_conflict")

	child := createChannel(t, h, authz, map[string]any{"name": "child", "parentId": root.Id.String()})
	if child.ParentId == nil || *child.ParentId != root.Id {
		t.Fatal("child parent mismatch")
	}
	cousin := createChannel(t, h, authz, map[string]any{"name": "child"})
	if cousin.Name != "child" || cousin.ParentId != nil {
		t.Fatal("same name under different parent should succeed")
	}
	movable := createChannel(t, h, authz, map[string]any{"name": "movable"})

	empty := doJSON(t, h, http.MethodPost, "/v1/channels", authz, map[string]any{"name": "   "})
	if empty.Code != http.StatusBadRequest {
		t.Fatalf("empty name=%d", empty.Code)
	}

	renamed := patchJSON(t, h, "/v1/channels/"+root.Id.String(), authz, map[string]any{"name": "inbox"})
	if renamed.Name != "inbox" {
		t.Fatalf("rename=%q", renamed.Name)
	}
	patchConflict := doJSON(t, h, http.MethodPatch, "/v1/channels/"+cousin.Id.String(), authz, map[string]any{"name": "inbox"})
	if patchConflict.Code != http.StatusConflict {
		t.Fatalf("rename conflict=%d", patchConflict.Code)
	}

	moved := postJSON(t, h, "/v1/channels/"+movable.Id.String()+"/move", authz, map[string]any{
		"parentId": root.Id.String(),
	})
	if moved.ParentId == nil || *moved.ParentId != root.Id {
		t.Fatal("move parent not updated")
	}
	if moved.SortKey == "" {
		t.Fatal("move must return sortKey")
	}

	cycle := doJSON(t, h, http.MethodPost, "/v1/channels/"+root.Id.String()+"/move", authz, map[string]any{
		"parentId": child.Id.String(),
	})
	if cycle.Code != http.StatusConflict {
		t.Fatalf("cycle=%d body=%s", cycle.Code, cycle.Body)
	}
	assertErrorCode(t, cycle.Body, "cycle")

	otherRoot := createChannel(t, h, authz, map[string]any{"name": "other"})
	createChannel(t, h, authz, map[string]any{"name": "inbox", "parentId": otherRoot.Id.String()})
	moveClash := doJSON(t, h, http.MethodPost, "/v1/channels/"+renamed.Id.String()+"/move", authz, map[string]any{
		"parentId": otherRoot.Id.String(),
	})
	if moveClash.Code != http.StatusConflict {
		t.Fatalf("move name clash=%d body=%s", moveClash.Code, moveClash.Body)
	}
	assertErrorCode(t, moveClash.Body, "name_conflict")

	leaf := createChannel(t, h, authz, map[string]any{"name": "leaf"})
	del := doJSON(t, h, http.MethodDelete, "/v1/channels/"+leaf.Id.String(), authz, nil)
	if del.Code != http.StatusNoContent {
		t.Fatalf("delete empty=%d %s", del.Code, del.Body)
	}

	pool, err := pgxpool.New(context.Background(), url)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	var userID uuid.UUID
	if err := pool.QueryRow(context.Background(), `select id from users where auth_subject = $1`, "user-sub").Scan(&userID); err != nil {
		t.Fatal(err)
	}
	var count int
	if err := pool.QueryRow(context.Background(), `select count(*) from users where auth_subject = $1`, "user-sub").Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Fatalf("user upsert duplicates: %d", count)
	}

	withPosts := createChannel(t, h, authz, map[string]any{"name": "with-posts"})
	if _, err := pool.Exec(context.Background(),
		`insert into posts (channel_id, author_id, body) values ($1, $2, 'hello')`,
		withPosts.Id, userID,
	); err != nil {
		t.Fatal(err)
	}
	blocked := doJSON(t, h, http.MethodDelete, "/v1/channels/"+withPosts.Id.String(), authz, nil)
	if blocked.Code != http.StatusConflict {
		t.Fatalf("delete with posts=%d %s", blocked.Code, blocked.Body)
	}
	assertErrorCode(t, blocked.Body, "channel_has_posts")

	parent := createChannel(t, h, authz, map[string]any{"name": "parent-posts"})
	nested := createChannel(t, h, authz, map[string]any{"name": "nested", "parentId": parent.Id.String()})
	if _, err := pool.Exec(context.Background(),
		`insert into posts (channel_id, author_id, body) values ($1, $2, 'nested')`,
		nested.Id, userID,
	); err != nil {
		t.Fatal(err)
	}
	blockedParent := doJSON(t, h, http.MethodDelete, "/v1/channels/"+parent.Id.String(), authz, nil)
	if blockedParent.Code != http.StatusConflict {
		t.Fatalf("delete parent with descendant posts=%d %s", blockedParent.Code, blockedParent.Body)
	}

	softOnly := createChannel(t, h, authz, map[string]any{"name": "soft-only"})
	var softPostID uuid.UUID
	if err := pool.QueryRow(context.Background(),
		`insert into posts (channel_id, author_id, body, deleted_at) values ($1, $2, 'gone', now()) returning id`,
		softOnly.Id, userID,
	).Scan(&softPostID); err != nil {
		t.Fatal(err)
	}
	softAttachmentID := uuid.New()
	if _, err := pool.Exec(context.Background(), `
		insert into attachments (
			id, post_id, uploader_id, file_name, content_type, size_bytes,
			storage_key, checksum, completed_at
		) values ($1, $2, $3, 'soft.txt', 'text/plain', 4, $4, 'sum', now())`,
		softAttachmentID, softPostID, userID, "attachments/soft-channel"); err != nil {
		t.Fatal(err)
	}
	okDel := doJSON(t, h, http.MethodDelete, "/v1/channels/"+softOnly.Id.String(), authz, nil)
	if okDel.Code != http.StatusNoContent {
		t.Fatalf("delete soft-only=%d %s", okDel.Code, okDel.Body)
	}
	var detachedPostID *uuid.UUID
	var deletionPendingAt *time.Time
	if err := pool.QueryRow(context.Background(), `
		select post_id, deletion_pending_at from attachments where id = $1`,
		softAttachmentID,
	).Scan(&detachedPostID, &deletionPendingAt); err != nil {
		t.Fatal(err)
	}
	if detachedPostID != nil || deletionPendingAt == nil {
		t.Fatalf("attachment after channel delete post=%v pending=%v", detachedPostID, deletionPendingAt)
	}

	token2 := mint(t, key, kid, "user-sub")
	list := doJSON(t, h, http.MethodGet, "/v1/channels", "Bearer "+token2, nil)
	if list.Code != http.StatusOK {
		t.Fatalf("list=%d %s", list.Code, list.Body)
	}
	if jwksHits != 1 {
		t.Fatalf("jwks hits=%d want 1 (cached keys)", jwksHits)
	}
}

type httpResult struct {
	Code int
	Body []byte
}

func createChannel(t *testing.T, h http.Handler, authz string, body map[string]any) api.Channel {
	t.Helper()
	res := doJSON(t, h, http.MethodPost, "/v1/channels", authz, body)
	if res.Code != http.StatusCreated {
		t.Fatalf("create %v: %d %s", body, res.Code, res.Body)
	}
	var ch api.Channel
	if err := json.Unmarshal(res.Body, &ch); err != nil {
		t.Fatal(err)
	}
	return ch
}

func patchJSON(t *testing.T, h http.Handler, path, authz string, body map[string]any) api.Channel {
	t.Helper()
	res := doJSON(t, h, http.MethodPatch, path, authz, body)
	if res.Code != http.StatusOK {
		t.Fatalf("patch %s: %d %s", path, res.Code, res.Body)
	}
	var ch api.Channel
	if err := json.Unmarshal(res.Body, &ch); err != nil {
		t.Fatal(err)
	}
	return ch
}

func postJSON(t *testing.T, h http.Handler, path, authz string, body map[string]any) api.Channel {
	t.Helper()
	res := doJSON(t, h, http.MethodPost, path, authz, body)
	if res.Code != http.StatusOK {
		t.Fatalf("post %s: %d %s", path, res.Code, res.Body)
	}
	var ch api.Channel
	if err := json.Unmarshal(res.Body, &ch); err != nil {
		t.Fatal(err)
	}
	return ch
}

func doJSON(t *testing.T, h http.Handler, method, path, authz string, body map[string]any) httpResult {
	t.Helper()
	var buf bytes.Buffer
	if body != nil {
		if err := json.NewEncoder(&buf).Encode(body); err != nil {
			t.Fatal(err)
		}
	}
	req := httptest.NewRequest(method, path, &buf)
	req.Header.Set("Authorization", authz)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return httpResult{Code: rec.Code, Body: rec.Body.Bytes()}
}

func assertErrorCode(t *testing.T, raw []byte, want string) {
	t.Helper()
	var e api.Error
	if err := json.Unmarshal(raw, &e); err != nil {
		t.Fatalf("decode error: %v %s", err, raw)
	}
	if e.Code != want {
		t.Fatalf("code=%q want %q body=%s", e.Code, want, raw)
	}
}

func testRSA(t *testing.T) (*ecdsa.PrivateKey, []byte, string) {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	x := key.X.FillBytes(make([]byte, 32))
	y := key.Y.FillBytes(make([]byte, 32))
	kid := base64.RawURLEncoding.EncodeToString(x[:8])
	jwks, _ := json.Marshal(map[string]any{
		"keys": []map[string]string{{
			"kid": kid,
			"kty": "EC",
			"crv": "P-256",
			"alg": "ES256",
			"x":   base64.RawURLEncoding.EncodeToString(x),
			"y":   base64.RawURLEncoding.EncodeToString(y),
		}},
	})
	return key, jwks, kid
}

func mint(t *testing.T, key *ecdsa.PrivateKey, kid, sub string) string {
	t.Helper()
	return mintClaims(t, key, kid, jwt.MapClaims{
		"iss":  "https://issuer.example",
		"sub":  sub,
		"aud":  "authenticated",
		"role": "authenticated",
		"exp":  time.Now().Add(time.Hour).Unix(),
		"iat":  time.Now().Unix(),
	})
}

func mintClaims(t *testing.T, key *ecdsa.PrivateKey, kid string, claims jwt.MapClaims) string {
	t.Helper()
	tok := jwt.NewWithClaims(jwt.SigningMethodES256, claims)
	tok.Header["kid"] = kid
	s, err := tok.SignedString(key)
	if err != nil {
		t.Fatal(err)
	}
	return s
}
