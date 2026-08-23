package httpapi_test

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestEventStreamDeliversCommittedChanges(t *testing.T) {
	h, authz, _ := searchTestServer(t)
	channel := createChannel(t, h, authz, map[string]any{"name": "stream"})
	server := httptest.NewServer(h)
	t.Cleanup(server.Close)
	unauthorized, err := http.Get(server.URL + "/v1/events/stream")
	if err != nil {
		t.Fatal(err)
	}
	_ = unauthorized.Body.Close()
	if unauthorized.StatusCode != http.StatusUnauthorized {
		t.Fatalf("unauthorized stream=%d", unauthorized.StatusCode)
	}
	badRequest, err := http.NewRequest(http.MethodGet, server.URL+"/v1/events/stream", nil)
	if err != nil {
		t.Fatal(err)
	}
	badRequest.Header.Set("Authorization", authz)
	badRequest.Header.Set("Last-Event-ID", "invalid")
	badResponse, err := http.DefaultClient.Do(badRequest)
	if err != nil {
		t.Fatal(err)
	}
	_ = badResponse.Body.Close()
	if badResponse.StatusCode != http.StatusBadRequest {
		t.Fatalf("invalid Last-Event-ID=%d", badResponse.StatusCode)
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	response := openEventStream(t, ctx, server.URL, authz, "")
	defer response.Body.Close()

	created := createPost(t, h, authz, channel.Id.String(), "streamed")
	frame := readSSEFrame(t, bufio.NewReader(response.Body))
	if frame.Event != "post.created" || frame.Data.PostID == nil || *frame.Data.PostID != created.Id.String() {
		t.Fatalf("frame=%+v", frame)
	}
	if frame.ID != frame.Data.ID {
		t.Fatalf("SSE id=%q data id=%q", frame.ID, frame.Data.ID)
	}
}

func TestEventReplayUsesLastEventIDWithoutDuplicates(t *testing.T) {
	h, authz, _ := searchTestServer(t)
	channel := createChannel(t, h, authz, map[string]any{"name": "replay"})
	baselinePage := getEventPage(t, h, authz, "/v1/events?after=0&limit=200")
	baseline := baselinePage.NextAfter
	firstPost := createPost(t, h, authz, channel.Id.String(), "first replay")
	secondPost := createPost(t, h, authz, channel.Id.String(), "second replay")

	server := httptest.NewServer(h)
	t.Cleanup(server.Close)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	response := openEventStream(t, ctx, server.URL, authz, baseline)
	defer response.Body.Close()
	reader := bufio.NewReader(response.Body)
	first := readSSEFrame(t, reader)
	second := readSSEFrame(t, reader)

	if first.Data.PostID == nil || second.Data.PostID == nil {
		t.Fatalf("replayed frames=%+v %+v", first, second)
	}
	if *first.Data.PostID != firstPost.Id.String() || *second.Data.PostID != secondPost.Id.String() {
		t.Fatalf("replay order=%s,%s", *first.Data.PostID, *second.Data.PostID)
	}
	firstID, _ := strconv.ParseInt(first.ID, 10, 64)
	secondID, _ := strconv.ParseInt(second.ID, 10, 64)
	if firstID <= 0 || secondID <= firstID {
		t.Fatalf("replay IDs=%d,%d", firstID, secondID)
	}
}

type sseFrame struct {
	ID    string
	Event string
	Data  changeEventJSON
}

func openEventStream(t *testing.T, ctx context.Context, baseURL, authz, lastID string) *http.Response {
	t.Helper()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, baseURL+"/v1/events/stream", nil)
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Authorization", authz)
	if lastID != "" {
		req.Header.Set("Last-Event-ID", lastID)
	}
	response, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(response.Body)
		_ = response.Body.Close()
		t.Fatalf("stream=%d %s", response.StatusCode, body)
	}
	if got := response.Header.Get("Content-Type"); !strings.HasPrefix(got, "text/event-stream") {
		response.Body.Close()
		t.Fatalf("content-type=%q", got)
	}
	return response
}

func readSSEFrame(t *testing.T, reader *bufio.Reader) sseFrame {
	t.Helper()
	type result struct {
		frame sseFrame
		err   error
	}
	done := make(chan result, 1)
	go func() {
		var frame sseFrame
		var data []string
		for {
			line, err := reader.ReadString('\n')
			if err != nil {
				done <- result{err: err}
				return
			}
			line = strings.TrimSuffix(strings.TrimSuffix(line, "\n"), "\r")
			if line == "" {
				if len(data) == 0 {
					continue
				}
				if err := json.Unmarshal([]byte(strings.Join(data, "\n")), &frame.Data); err != nil {
					done <- result{err: err}
					return
				}
				done <- result{frame: frame}
				return
			}
			if strings.HasPrefix(line, "id:") {
				frame.ID = strings.TrimSpace(strings.TrimPrefix(line, "id:"))
			}
			if strings.HasPrefix(line, "event:") {
				frame.Event = strings.TrimSpace(strings.TrimPrefix(line, "event:"))
			}
			if strings.HasPrefix(line, "data:") {
				data = append(data, strings.TrimSpace(strings.TrimPrefix(line, "data:")))
			}
		}
	}()
	select {
	case got := <-done:
		if got.err != nil {
			t.Fatal(got.err)
		}
		return got.frame
	case <-time.After(5 * time.Second):
		t.Fatal(fmt.Errorf("timed out waiting for SSE frame"))
		return sseFrame{}
	}
}

type changeEventJSON struct {
	ID           string  `json:"id"`
	EventType    string  `json:"eventType"`
	ChannelID    *string `json:"channelId"`
	PostID       *string `json:"postId"`
	ThreadRootID *string `json:"threadRootId"`
	CreatedAt    string  `json:"createdAt"`
}

type changeEventPageJSON struct {
	Events    []changeEventJSON `json:"events"`
	NextAfter string            `json:"nextAfter"`
	HasMore   bool              `json:"hasMore"`
}

func TestEventDiffReturnsDurableOrderedChanges(t *testing.T) {
	h, authz, databaseURL := searchTestServer(t)
	channel := createChannel(t, h, authz, map[string]any{"name": "events"})
	root := createPost(t, h, authz, channel.Id.String(), "root")
	reply := createReply(t, h, authz, root.Id.String(), "reply")

	pool, err := pgxpool.New(context.Background(), databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	emojiID := uuid.New()
	if _, err := pool.Exec(context.Background(), `
		insert into emojis (id, shortcode, storage_key, checksum)
		values ($1, 'event_test', 'event_test.png', 'checksum')
	`, emojiID); err != nil {
		t.Fatal(err)
	}
	reaction := doJSON(t, h, http.MethodPut,
		"/v1/posts/"+root.Id.String()+"/reactions/"+emojiID.String(), authz, nil)
	if reaction.Code != http.StatusOK {
		t.Fatalf("reaction=%d %s", reaction.Code, reaction.Body)
	}

	unauthorized := doJSON(t, h, http.MethodGet, "/v1/events?after=0", "", nil)
	if unauthorized.Code != http.StatusUnauthorized {
		t.Fatalf("unauthorized=%d", unauthorized.Code)
	}

	first := getEventPage(t, h, authz, "/v1/events?after=0&limit=2")
	if len(first.Events) != 2 || !first.HasMore {
		t.Fatalf("first page=%+v", first)
	}
	if first.NextAfter != first.Events[len(first.Events)-1].ID {
		t.Fatalf("nextAfter=%q last=%q", first.NextAfter, first.Events[len(first.Events)-1].ID)
	}
	second := getEventPage(t, h, authz, "/v1/events?after="+first.NextAfter+"&limit=200")
	all := append(append([]changeEventJSON{}, first.Events...), second.Events...)
	assertIncreasingEventIDs(t, all)
	assertEvent(t, all, "channel.created", channel.Id.String(), "", "")
	assertEvent(t, all, "post.created", channel.Id.String(), root.Id.String(), "")
	assertEvent(t, all, "reply.created", channel.Id.String(), reply.Id.String(), root.Id.String())
	assertEvent(t, all, "reaction.updated", channel.Id.String(), root.Id.String(), "")

	lastID := all[len(all)-1].ID
	renamed := doJSON(t, h, http.MethodPatch, "/v1/channels/"+channel.Id.String(), authz, map[string]any{"name": "events-renamed"})
	if renamed.Code != http.StatusOK {
		t.Fatalf("rename=%d %s", renamed.Code, renamed.Body)
	}
	later := getEventPage(t, h, authz, "/v1/events?after="+lastID+"&limit=200")
	if len(later.Events) != 1 || later.Events[0].EventType != "channel.updated" {
		t.Fatalf("later=%+v", later)
	}
	if later.Events[0].ID == lastID {
		t.Fatal("after cursor returned a duplicate event")
	}

	for _, after := range []string{"-1", "not-a-number", "9223372036854775808"} {
		res := doJSON(t, h, http.MethodGet, "/v1/events?after="+after, authz, nil)
		if res.Code != http.StatusBadRequest {
			t.Fatalf("after=%q status=%d body=%s", after, res.Code, res.Body)
		}
	}
}

func getEventPage(t *testing.T, h http.Handler, authz, path string) changeEventPageJSON {
	t.Helper()
	res := doJSON(t, h, http.MethodGet, path, authz, nil)
	if res.Code != http.StatusOK {
		t.Fatalf("events=%d %s", res.Code, res.Body)
	}
	var page changeEventPageJSON
	if err := json.Unmarshal(res.Body, &page); err != nil {
		t.Fatal(err)
	}
	if page.Events == nil {
		t.Fatal("events must be an empty array, not null")
	}
	return page
}

func assertIncreasingEventIDs(t *testing.T, events []changeEventJSON) {
	t.Helper()
	var previous int64
	for _, event := range events {
		id, err := strconv.ParseInt(event.ID, 10, 64)
		if err != nil {
			t.Fatalf("event id %q: %v", event.ID, err)
		}
		if id <= previous {
			t.Fatalf("event IDs are not increasing: %d then %d", previous, id)
		}
		if event.CreatedAt == "" {
			t.Fatal("event createdAt is empty")
		}
		previous = id
	}
}

func assertEvent(t *testing.T, events []changeEventJSON, eventType, channelID, postID, threadRootID string) {
	t.Helper()
	for _, event := range events {
		if event.EventType != eventType || stringValue(event.ChannelID) != channelID {
			continue
		}
		if stringValue(event.PostID) == postID && stringValue(event.ThreadRootID) == threadRootID {
			return
		}
	}
	t.Fatalf("missing %s channel=%s post=%s thread=%s in %+v", eventType, channelID, postID, threadRootID, events)
}

func stringValue(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}
