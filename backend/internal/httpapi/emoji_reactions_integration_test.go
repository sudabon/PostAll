package httpapi_test

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/sudabon/PostAll/backend/internal/auth"
	"github.com/sudabon/PostAll/backend/internal/httpapi"
	"github.com/sudabon/PostAll/backend/internal/testutil"
)

type emojiJSON struct {
	ID        string `json:"id"`
	Shortcode string `json:"shortcode"`
	ImagePath string `json:"imagePath"`
	Checksum  string `json:"checksum"`
}

type reactionJSON struct {
	Emoji       emojiJSON `json:"emoji"`
	Count       int       `json:"count"`
	ReactedByMe bool      `json:"reactedByMe"`
	ReactorIDs  []string  `json:"reactorIds"`
}

func TestEmojiCatalogAndReactionLifecycle(t *testing.T) {
	databaseURL := testutil.PostgresURL(t)
	key, jwks, kid := testRSA(t)
	jwksServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write(jwks)
	}))
	t.Cleanup(jwksServer.Close)

	verifier := auth.NewVerifierFromURL(jwksServer.URL, "https://issuer.example", "client-1", jwksServer.Client())
	h, err := httpapi.New(httpapi.Config{DatabaseURL: databaseURL, Verifier: verifier})
	if err != nil {
		t.Fatal(err)
	}
	userAuth := "Bearer " + mint(t, key, kid, "reaction-user")
	otherAuth := "Bearer " + mint(t, key, kid, "other-user")

	channel := createChannel(t, h, userAuth, map[string]any{"name": "emoji"})
	post := createPost(t, h, userAuth, channel.Id.String(), "react to me")

	pool, err := pgxpool.New(context.Background(), databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	var emojiID uuid.UUID
	if err := pool.QueryRow(context.Background(), `
		insert into emojis (shortcode, storage_key, checksum)
		values ('shipit', 'shipit.png', 'sum-1') returning id
	`).Scan(&emojiID); err != nil {
		t.Fatal(err)
	}

	unauthorized := doJSON(t, h, http.MethodGet, "/v1/emojis", "", nil)
	if unauthorized.Code != http.StatusUnauthorized {
		t.Fatalf("unauthorized catalog = %d", unauthorized.Code)
	}

	catalog := doJSON(t, h, http.MethodGet, "/v1/emojis", userAuth, nil)
	if catalog.Code != http.StatusOK {
		t.Fatalf("catalog = %d %s", catalog.Code, catalog.Body)
	}
	var list struct {
		Emojis []emojiJSON `json:"emojis"`
	}
	if err := json.Unmarshal(catalog.Body, &list); err != nil {
		t.Fatal(err)
	}
	if len(list.Emojis) != 1 || list.Emojis[0].Shortcode != "shipit" || list.Emojis[0].ImagePath != "/v1/emojis/shipit/image" {
		t.Fatalf("catalog body = %+v", list)
	}

	path := "/v1/posts/" + post.Id.String() + "/reactions/" + emojiID.String()
	added := doJSON(t, h, http.MethodPut, path, userAuth, nil)
	if added.Code != http.StatusOK {
		t.Fatalf("add reaction = %d %s", added.Code, added.Body)
	}
	assertReaction(t, added.Body, 1, true, 1)

	duplicate := doJSON(t, h, http.MethodPut, path, userAuth, nil)
	if duplicate.Code != http.StatusOK {
		t.Fatalf("duplicate reaction = %d %s", duplicate.Code, duplicate.Body)
	}
	assertReaction(t, duplicate.Body, 1, true, 1)

	other := doJSON(t, h, http.MethodPut, path, otherAuth, nil)
	if other.Code != http.StatusOK {
		t.Fatalf("other reaction = %d %s", other.Code, other.Body)
	}
	assertReaction(t, other.Body, 2, true, 2)

	page := doJSON(t, h, http.MethodGet, "/v1/channels/"+channel.Id.String()+"/posts", userAuth, nil)
	if page.Code != http.StatusOK {
		t.Fatalf("timeline = %d %s", page.Code, page.Body)
	}
	assertPostReaction(t, page.Body, post.Id.String(), 2, true)

	removed := doJSON(t, h, http.MethodDelete, path, userAuth, nil)
	if removed.Code != http.StatusNoContent {
		t.Fatalf("remove reaction = %d %s", removed.Code, removed.Body)
	}
	removedAgain := doJSON(t, h, http.MethodDelete, path, userAuth, nil)
	if removedAgain.Code != http.StatusNoContent {
		t.Fatalf("idempotent remove = %d %s", removedAgain.Code, removedAgain.Body)
	}
	page = doJSON(t, h, http.MethodGet, "/v1/channels/"+channel.Id.String()+"/posts", userAuth, nil)
	assertPostReaction(t, page.Body, post.Id.String(), 1, false)

	missing := doJSON(t, h, http.MethodPut, "/v1/posts/"+post.Id.String()+"/reactions/"+uuid.NewString(), userAuth, nil)
	if missing.Code != http.StatusNotFound {
		t.Fatalf("missing emoji = %d %s", missing.Code, missing.Body)
	}

	deleted := doJSON(t, h, http.MethodDelete, "/v1/posts/"+post.Id.String(), userAuth, nil)
	if deleted.Code != http.StatusNoContent {
		t.Fatalf("delete post = %d", deleted.Code)
	}
	toDeleted := doJSON(t, h, http.MethodPut, path, userAuth, nil)
	if toDeleted.Code != http.StatusConflict {
		t.Fatalf("reaction on deleted post = %d %s", toDeleted.Code, toDeleted.Body)
	}
}

func TestEmojiImageDelivery(t *testing.T) {
	databaseURL := testutil.PostgresURL(t)
	key, jwks, kid := testRSA(t)
	jwksServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write(jwks)
	}))
	t.Cleanup(jwksServer.Close)

	emojiDir := t.TempDir()
	png := []byte("\x89PNG\r\n\x1a\npostall-test")
	if err := os.WriteFile(filepath.Join(emojiDir, "shipit.png"), png, 0o600); err != nil {
		t.Fatal(err)
	}

	verifier := auth.NewVerifierFromURL(jwksServer.URL, "https://issuer.example", "client-1", jwksServer.Client())
	h, err := httpapi.New(httpapi.Config{DatabaseURL: databaseURL, Verifier: verifier, EmojiDir: emojiDir})
	if err != nil {
		t.Fatal(err)
	}
	authz := "Bearer " + mint(t, key, kid, "image-user")

	pool, err := pgxpool.New(context.Background(), databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	if _, err := pool.Exec(context.Background(), `
		insert into emojis (shortcode, storage_key, checksum) values
			('shipit', 'shipit.png', 'sum-1'),
			('missing', 'missing.png', 'sum-2')
	`); err != nil {
		t.Fatal(err)
	}

	unauthorized := doJSON(t, h, http.MethodGet, "/v1/emojis/shipit/image", "", nil)
	if unauthorized.Code != http.StatusUnauthorized {
		t.Fatalf("unauthorized image = %d", unauthorized.Code)
	}

	req := httptest.NewRequest(http.MethodGet, "/v1/emojis/shipit/image", nil)
	req.Header.Set("Authorization", authz)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("image = %d %s", rec.Code, rec.Body.Bytes())
	}
	if got := rec.Header().Get("Content-Type"); got != "image/png" {
		t.Fatalf("content type = %q", got)
	}
	if !bytes.Equal(rec.Body.Bytes(), png) {
		t.Fatalf("image body = %q", rec.Body.Bytes())
	}

	missing := doJSON(t, h, http.MethodGet, "/v1/emojis/missing/image", authz, nil)
	if missing.Code != http.StatusNotFound {
		t.Fatalf("missing image = %d %s", missing.Code, missing.Body)
	}
}

func assertReaction(t *testing.T, body []byte, count int, reactedByMe bool, reactors int) {
	t.Helper()
	var reaction reactionJSON
	if err := json.Unmarshal(body, &reaction); err != nil {
		t.Fatal(err)
	}
	if reaction.Emoji.Shortcode != "shipit" || reaction.Count != count || reaction.ReactedByMe != reactedByMe || len(reaction.ReactorIDs) != reactors {
		t.Fatalf("reaction = %+v", reaction)
	}
}

func assertPostReaction(t *testing.T, body []byte, postID string, count int, reactedByMe bool) {
	t.Helper()
	var page struct {
		Posts []struct {
			ID        string         `json:"id"`
			Reactions []reactionJSON `json:"reactions"`
		} `json:"posts"`
	}
	if err := json.Unmarshal(body, &page); err != nil {
		t.Fatal(err)
	}
	if len(page.Posts) != 1 || page.Posts[0].ID != postID || len(page.Posts[0].Reactions) != 1 {
		t.Fatalf("timeline reactions = %+v", page)
	}
	reaction := page.Posts[0].Reactions[0]
	if reaction.Count != count || reaction.ReactedByMe != reactedByMe {
		t.Fatalf("timeline reaction = %+v", reaction)
	}
}
