package httpapi_test

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/sudabon/PostAll/backend/internal/auth"
	"github.com/sudabon/PostAll/backend/internal/httpapi"
	"github.com/sudabon/PostAll/backend/internal/testutil"
)

// 親ポストを論理削除するとスレッド全体がタイムラインから消える。残る返信は
// 論理削除された親に属するためチャネル削除を阻んではならない。
func TestDeleteChannelWhenOnlyRepliesOfDeletedRootRemain(t *testing.T) {
	h, authz := channelDeleteTestServer(t)

	ch := createChannel(t, h, authz, map[string]any{"name": "thread-only"})
	root := createPost(t, h, authz, ch.Id.String(), "root")
	createReply(t, h, authz, root.Id.String(), "reply")

	res := doJSON(t, h, http.MethodDelete, "/v1/posts/"+root.Id.String(), authz, nil)
	if res.Code != http.StatusNoContent {
		t.Fatalf("delete root post=%d %s", res.Code, res.Body)
	}
	if page := listPosts(t, h, authz, ch.Id.String(), ""); len(page.Posts) != 0 {
		t.Fatalf("timeline len=%d want 0", len(page.Posts))
	}

	del := doJSON(t, h, http.MethodDelete, "/v1/channels/"+ch.Id.String(), authz, nil)
	if del.Code != http.StatusNoContent {
		t.Fatalf("delete channel=%d %s", del.Code, del.Body)
	}
	if list := doJSON(t, h, http.MethodGet, "/v1/channels", authz, nil); list.Code != http.StatusOK {
		t.Fatalf("list channels=%d %s", list.Code, list.Body)
	}
}

// 生きている親ポストに属する返信は引き続きチャネル削除を阻む。
func TestDeleteChannelBlockedByReplyOfLiveRoot(t *testing.T) {
	h, authz := channelDeleteTestServer(t)

	ch := createChannel(t, h, authz, map[string]any{"name": "live-thread"})
	root := createPost(t, h, authz, ch.Id.String(), "root")
	createReply(t, h, authz, root.Id.String(), "reply")

	del := doJSON(t, h, http.MethodDelete, "/v1/channels/"+ch.Id.String(), authz, nil)
	if del.Code != http.StatusConflict {
		t.Fatalf("delete channel=%d %s", del.Code, del.Body)
	}
	assertErrorCode(t, del.Body, "channel_has_posts")
}

func channelDeleteTestServer(t *testing.T) (http.Handler, string) {
	t.Helper()
	dbURL := testutil.PostgresURL(t)
	key, jwks, kid := testRSA(t)
	jwksSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write(jwks)
	}))
	t.Cleanup(jwksSrv.Close)

	verifier := auth.NewVerifierFromURL(jwksSrv.URL, "https://issuer.example", "authenticated", jwksSrv.Client())
	h, err := httpapi.New(httpapi.Config{DatabaseURL: dbURL, Verifier: verifier})
	if err != nil {
		t.Fatal(err)
	}
	return h, "Bearer " + mint(t, key, kid, "user-sub")
}
