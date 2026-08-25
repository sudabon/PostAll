package httpapi_test

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/sudabon/PostAll/backend/internal/api"
	"github.com/sudabon/PostAll/backend/internal/auth"
	"github.com/sudabon/PostAll/backend/internal/httpapi"
	"github.com/sudabon/PostAll/backend/internal/testutil"
)

type searchResultJSON struct {
	PostID         string  `json:"postId"`
	TimelinePostID string  `json:"timelinePostId"`
	ChannelID      string  `json:"channelId"`
	ChannelName    string  `json:"channelName"`
	ThreadRootID   *string `json:"threadRootId"`
	Body           string  `json:"body"`
	CreatedAt      string  `json:"createdAt"`
}

type searchPageJSON struct {
	Results    []searchResultJSON `json:"results"`
	NextCursor *string            `json:"nextCursor"`
}

func TestSearchPostsFiltersThreadsAndPaginates(t *testing.T) {
	h, authz, databaseURL := searchTestServer(t)
	primary := createChannel(t, h, authz, map[string]any{"name": "検索"})
	other := createChannel(t, h, authz, map[string]any{"name": "別チャネル"})

	root := createPost(t, h, authz, primary.Id.String(), "Alpha 日本語の検索対象メモ")
	reply := createReply(t, h, authz, root.Id.String(), "返信にも検索対象があります")
	second := createPost(t, h, authz, primary.Id.String(), "SEARCHTARGET alpha")
	otherMatch := createPost(t, h, authz, other.Id.String(), "別の検索対象")
	deleted := createPost(t, h, authz, primary.Id.String(), "削除された検索対象")
	res := doJSON(t, h, http.MethodDelete, "/v1/posts/"+deleted.Id.String(), authz, nil)
	if res.Code != http.StatusNoContent {
		t.Fatalf("delete=%d %s", res.Code, res.Body)
	}

	unauthorized := doJSON(t, h, http.MethodGet, "/v1/search?q="+url.QueryEscape("検索対象"), "", nil)
	if unauthorized.Code != http.StatusUnauthorized {
		t.Fatalf("unauthorized=%d", unauthorized.Code)
	}
	oneRune := doJSON(t, h, http.MethodGet, "/v1/search?q="+url.QueryEscape("検"), authz, nil)
	if oneRune.Code != http.StatusBadRequest {
		t.Fatalf("one-rune=%d %s", oneRune.Code, oneRune.Body)
	}

	page := searchPosts(t, h, authz, "/v1/search?q="+url.QueryEscape("検索対象"))
	assertSearchIDs(t, page.Results, []string{root.Id.String(), reply.Id.String(), otherMatch.Id.String()}, deleted.Id.String())
	var replyResult *searchResultJSON
	for i := range page.Results {
		if page.Results[i].PostID == reply.Id.String() {
			replyResult = &page.Results[i]
			break
		}
	}
	if replyResult == nil || replyResult.ThreadRootID == nil || *replyResult.ThreadRootID != root.Id.String() {
		t.Fatalf("reply result=%+v", replyResult)
	}
	if replyResult.TimelinePostID != root.Id.String() {
		t.Fatalf("timelinePostId=%q want %s", replyResult.TimelinePostID, root.Id)
	}

	filteredPath := fmt.Sprintf(
		"/v1/search?q=%s&channelId=%s&createdFrom=%s&createdTo=%s",
		url.QueryEscape("検索対象"),
		primary.Id,
		url.QueryEscape(time.Now().Add(-time.Hour).Format(time.RFC3339)),
		url.QueryEscape(time.Now().Add(time.Hour).Format(time.RFC3339)),
	)
	filtered := searchPosts(t, h, authz, filteredPath)
	assertSearchIDs(t, filtered.Results, []string{root.Id.String(), reply.Id.String()}, otherMatch.Id.String())

	caseInsensitive := searchPosts(t, h, authz, "/v1/search?q=searchtarget")
	assertSearchIDs(t, caseInsensitive.Results, []string{second.Id.String()}, "")

	firstPage := searchPosts(t, h, authz, "/v1/search?q="+url.QueryEscape("検索対象")+"&limit=2")
	if len(firstPage.Results) != 2 || firstPage.NextCursor == nil {
		t.Fatalf("first page=%+v", firstPage)
	}
	secondPage := searchPosts(t, h, authz, "/v1/search?q="+url.QueryEscape("検索対象")+"&limit=2&cursor="+url.QueryEscape(*firstPage.NextCursor))
	seen := map[string]bool{}
	for _, item := range firstPage.Results {
		seen[item.PostID] = true
	}
	for _, item := range secondPage.Results {
		if seen[item.PostID] {
			t.Fatalf("duplicate paged result %s", item.PostID)
		}
	}

	pool, err := pgxpool.New(context.Background(), databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	var indexed bool
	if err := pool.QueryRow(context.Background(), `
		select exists (
			select 1 from pg_indexes
			where indexname = 'posts_body_bigm' and indexdef like '%lower(body)%'
		)
	`).Scan(&indexed); err != nil {
		t.Fatal(err)
	}
	if !indexed {
		t.Fatal("search expression index is missing")
	}
}

func TestTimelineAroundIncludesAnOlderSourcePost(t *testing.T) {
	h, authz, _ := searchTestServer(t)
	channel := createChannel(t, h, authz, map[string]any{"name": "履歴"})
	var posts []api.Post
	for i := 0; i < 15; i++ {
		posts = append(posts, createPost(t, h, authz, channel.Id.String(), fmt.Sprintf("履歴-%02d", i)))
	}
	target := posts[1]
	normal := listPosts(t, h, authz, channel.Id.String(), "")
	for _, item := range normal.Posts {
		if item.Id == target.Id {
			t.Fatal("target unexpectedly present in latest page")
		}
	}

	res := doJSON(t, h, http.MethodGet,
		"/v1/channels/"+channel.Id.String()+"/posts?around="+target.Id.String(), authz, nil)
	if res.Code != http.StatusOK {
		t.Fatalf("around=%d %s", res.Code, res.Body)
	}
	var page api.PostList
	if err := json.Unmarshal(res.Body, &page); err != nil {
		t.Fatal(err)
	}
	if len(page.Posts) == 0 || page.Posts[len(page.Posts)-1].Id != target.Id {
		t.Fatalf("around page does not end at target: %+v", page.Posts)
	}
}

func searchTestServer(t *testing.T) (http.Handler, string, string) {
	t.Helper()
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
	return h, "Bearer " + mint(t, key, kid, "search-user"), databaseURL
}

func searchPosts(t *testing.T, h http.Handler, authz, path string) searchPageJSON {
	t.Helper()
	res := doJSON(t, h, http.MethodGet, path, authz, nil)
	if res.Code != http.StatusOK {
		t.Fatalf("search=%d %s", res.Code, res.Body)
	}
	var page searchPageJSON
	if err := json.Unmarshal(res.Body, &page); err != nil {
		t.Fatal(err)
	}
	return page
}

func assertSearchIDs(t *testing.T, results []searchResultJSON, want []string, excluded string) {
	t.Helper()
	got := map[string]bool{}
	for _, item := range results {
		got[item.PostID] = true
		if excluded != "" && item.PostID == excluded {
			t.Fatalf("excluded post %s was returned", excluded)
		}
	}
	for _, id := range want {
		if !got[id] {
			t.Fatalf("missing result %s in %+v", id, results)
		}
	}
}
