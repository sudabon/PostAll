package httpapi_test

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"sort"
	"testing"

	"github.com/google/uuid"
	"github.com/sudabon/PostAll/backend/internal/api"
	"github.com/sudabon/PostAll/backend/internal/auth"
	"github.com/sudabon/PostAll/backend/internal/httpapi"
	"github.com/sudabon/PostAll/backend/internal/testutil"
)

func TestPostTimelineAndThreads(t *testing.T) {
	url := testutil.PostgresURL(t)
	key, jwks, kid := testRSA(t)
	jwksSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write(jwks)
	}))
	t.Cleanup(jwksSrv.Close)

	verifier := auth.NewVerifierFromURL(jwksSrv.URL, "https://issuer.example", "client-1", jwksSrv.Client())
	h, err := httpapi.New(httpapi.Config{DatabaseURL: url, Verifier: verifier})
	if err != nil {
		t.Fatal(err)
	}
	authz := "Bearer " + mint(t, key, kid, "user-sub")

	parent := createChannel(t, h, authz, map[string]any{"name": "timeline"})
	child := createChannel(t, h, authz, map[string]any{"name": "child", "parentId": parent.Id.String()})

	empty := doJSON(t, h, http.MethodPost, "/v1/channels/"+parent.Id.String()+"/posts", authz, map[string]any{"body": "  "})
	if empty.Code != http.StatusBadRequest {
		t.Fatalf("empty body=%d %s", empty.Code, empty.Body)
	}
	assertErrorCode(t, empty.Body, "empty_content")

	var created []api.Post
	for i := 0; i < 15; i++ {
		created = append(created, createPost(t, h, authz, parent.Id.String(), fmt.Sprintf("p-%02d", i)))
	}
	childPost := createPost(t, h, authz, child.Id.String(), "only-in-child")

	page := listPosts(t, h, authz, parent.Id.String(), "")
	if len(page.Posts) != 10 {
		t.Fatalf("latest page len=%d want 10", len(page.Posts))
	}
	if page.NextBefore == nil {
		t.Fatal("expected nextBefore for remaining older posts")
	}
	sorted := append([]api.Post(nil), created...)
	sort.Slice(sorted, func(i, j int) bool {
		if !sorted[i].CreatedAt.Equal(sorted[j].CreatedAt) {
			return sorted[i].CreatedAt.Before(sorted[j].CreatedAt)
		}
		return uuid.UUID(sorted[i].Id).String() < uuid.UUID(sorted[j].Id).String()
	})
	assertPostIDs(t, page.Posts, sorted[5:])
	for i := 1; i < len(page.Posts); i++ {
		prev, cur := page.Posts[i-1], page.Posts[i]
		if cur.CreatedAt.Before(prev.CreatedAt) || (cur.CreatedAt.Equal(prev.CreatedAt) && uuid.UUID(cur.Id).String() <= uuid.UUID(prev.Id).String()) {
			t.Fatalf("timeline not ascending: %s then %s", prev.Id, cur.Id)
		}
	}
	for _, p := range page.Posts {
		if p.Body == "only-in-child" {
			t.Fatal("child channel posts must not appear")
		}
		if p.ThreadRootId != nil {
			t.Fatal("timeline must not include replies")
		}
		if p.Deleted {
			t.Fatal("timeline must not include deleted posts")
		}
	}

	older := listPosts(t, h, authz, parent.Id.String(), *page.NextBefore)
	if len(older.Posts) != 5 {
		t.Fatalf("older page len=%d want 5", len(older.Posts))
	}
	if older.NextBefore != nil {
		t.Fatalf("no further page, got %v", older.NextBefore)
	}
	assertPostIDs(t, older.Posts, sorted[:5])

	root := created[14]
	reply := createReply(t, h, authz, root.Id.String(), "reply-1")
	if reply.ThreadRootId == nil || reply.ThreadRootId.String() != root.Id.String() {
		t.Fatalf("reply root=%v", reply.ThreadRootId)
	}
	nested := createReply(t, h, authz, reply.Id.String(), "reply-to-reply")
	if nested.ThreadRootId == nil || nested.ThreadRootId.String() != root.Id.String() {
		t.Fatalf("nested reply must inherit root, got %v", nested.ThreadRootId)
	}

	afterReply := listPosts(t, h, authz, parent.Id.String(), "")
	for _, p := range afterReply.Posts {
		if p.Body == "reply-1" || p.Body == "reply-to-reply" {
			t.Fatal("replies must not appear on timeline")
		}
		if p.Id == root.Id && p.ReplyCount != 2 {
			t.Fatalf("replyCount=%d want 2", p.ReplyCount)
		}
		if p.Id == root.Id && p.LastReplyAt == nil {
			t.Fatal("lastReplyAt missing")
		}
	}

	thread := getThread(t, h, authz, nested.Id.String())
	if thread.Root.Id != root.Id {
		t.Fatalf("thread root=%s", thread.Root.Id)
	}
	if len(thread.Replies) != 2 {
		t.Fatalf("replies=%d", len(thread.Replies))
	}
	if thread.Replies[0].Body != "reply-1" || thread.Replies[1].Body != "reply-to-reply" {
		t.Fatalf("reply order %q %q", thread.Replies[0].Body, thread.Replies[1].Body)
	}

	edited := editPost(t, h, authz, root.Id.String(), "p-14-edited")
	if edited.Body != "p-14-edited" || edited.EditedAt == nil {
		t.Fatalf("edit=%+v", edited)
	}

	delReply := doJSON(t, h, http.MethodDelete, "/v1/posts/"+reply.Id.String(), authz, nil)
	if delReply.Code != http.StatusNoContent {
		t.Fatalf("delete reply=%d %s", delReply.Code, delReply.Body)
	}
	thread = getThread(t, h, authz, root.Id.String())
	if len(thread.Replies) != 1 || thread.Replies[0].Body != "reply-to-reply" {
		t.Fatalf("deleted reply still present: %+v", thread.Replies)
	}

	delRoot := doJSON(t, h, http.MethodDelete, "/v1/posts/"+root.Id.String(), authz, nil)
	if delRoot.Code != http.StatusNoContent {
		t.Fatalf("delete root=%d %s", delRoot.Code, delRoot.Body)
	}
	hidden := listPosts(t, h, authz, parent.Id.String(), "")
	for _, p := range hidden.Posts {
		if p.Id == root.Id {
			t.Fatal("deleted root must be hidden from timeline")
		}
	}
	placeholder := getThread(t, h, authz, nested.Id.String())
	if !placeholder.Root.Deleted || placeholder.Root.Body != "" {
		t.Fatalf("deleted root placeholder=%+v", placeholder.Root)
	}
	if len(placeholder.Replies) != 1 {
		t.Fatalf("live replies should remain, got %d", len(placeholder.Replies))
	}

	blocked := doJSON(t, h, http.MethodPatch, "/v1/posts/"+root.Id.String(), authz, map[string]any{"body": "nope"})
	if blocked.Code != http.StatusConflict {
		t.Fatalf("edit deleted=%d %s", blocked.Code, blocked.Body)
	}
	assertErrorCode(t, blocked.Body, "post_deleted")

	_ = childPost
}

func createPost(t *testing.T, h http.Handler, authz, channelID, body string) api.Post {
	t.Helper()
	res := doJSON(t, h, http.MethodPost, "/v1/channels/"+channelID+"/posts", authz, map[string]any{"body": body})
	if res.Code != http.StatusCreated {
		t.Fatalf("create post %q: %d %s", body, res.Code, res.Body)
	}
	var p api.Post
	if err := json.Unmarshal(res.Body, &p); err != nil {
		t.Fatal(err)
	}
	return p
}

func createReply(t *testing.T, h http.Handler, authz, postID, body string) api.Post {
	t.Helper()
	res := doJSON(t, h, http.MethodPost, "/v1/posts/"+postID+"/replies", authz, map[string]any{"body": body})
	if res.Code != http.StatusCreated {
		t.Fatalf("create reply %q: %d %s", body, res.Code, res.Body)
	}
	var p api.Post
	if err := json.Unmarshal(res.Body, &p); err != nil {
		t.Fatal(err)
	}
	return p
}

func editPost(t *testing.T, h http.Handler, authz, postID, body string) api.Post {
	t.Helper()
	res := doJSON(t, h, http.MethodPatch, "/v1/posts/"+postID, authz, map[string]any{"body": body})
	if res.Code != http.StatusOK {
		t.Fatalf("edit post: %d %s", res.Code, res.Body)
	}
	var p api.Post
	if err := json.Unmarshal(res.Body, &p); err != nil {
		t.Fatal(err)
	}
	return p
}

func listPosts(t *testing.T, h http.Handler, authz, channelID, before string) api.PostList {
	t.Helper()
	path := "/v1/channels/" + channelID + "/posts"
	if before != "" {
		path += "?before=" + url.QueryEscape(before)
	}
	res := doJSON(t, h, http.MethodGet, path, authz, nil)
	if res.Code != http.StatusOK {
		t.Fatalf("list posts: %d %s", res.Code, res.Body)
	}
	var page api.PostList
	if err := json.Unmarshal(res.Body, &page); err != nil {
		t.Fatal(err)
	}
	return page
}

func getThread(t *testing.T, h http.Handler, authz, postID string) api.Thread {
	t.Helper()
	res := doJSON(t, h, http.MethodGet, "/v1/posts/"+postID+"/thread", authz, nil)
	if res.Code != http.StatusOK {
		t.Fatalf("get thread: %d %s", res.Code, res.Body)
	}
	var th api.Thread
	if err := json.Unmarshal(res.Body, &th); err != nil {
		t.Fatal(err)
	}
	return th
}

func assertPostIDs(t *testing.T, got, want []api.Post) {
	t.Helper()
	if len(got) != len(want) {
		t.Fatalf("len=%d want %d", len(got), len(want))
	}
	for i := range got {
		if got[i].Id != want[i].Id {
			t.Fatalf("posts[%d]=%s want %s", i, got[i].Id, want[i].Id)
		}
	}
}
