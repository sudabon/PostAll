package httpapi_test

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

type changeEventJSON struct {
	ID           string  `json:"id"`
	EventType    string  `json:"eventType"`
	ChannelID    *string `json:"channelId"`
	PostID       *string `json:"postId"`
	ThreadRootID *string `json:"threadRootId"`
	CreatedAt    string  `json:"createdAt"`
}

type changeEventPageJSON struct {
	Events        []changeEventJSON `json:"events"`
	NextAfter     string            `json:"nextAfter"`
	HasMore       bool              `json:"hasMore"`
	ResetRequired bool              `json:"resetRequired"`
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
	latest := getEventPage(t, h, authz, "/v1/events?after=latest&limit=200")
	if len(latest.Events) != 0 || latest.HasMore || latest.ResetRequired {
		t.Fatalf("latest page=%+v", latest)
	}
	if latest.NextAfter != lastID {
		t.Fatalf("latest nextAfter=%q want %q", latest.NextAfter, lastID)
	}
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

	// 30 日保持によって途中のイベントが失われた状態を再現する。期限切れの
	// カーソルでは残存イベントだけを返さず、全体再取得を要求する。
	if _, err := pool.Exec(context.Background(), `
		with deleted as (
			delete from change_events
			where id < (select max(id) from change_events)
			returning id
		)
		insert into change_event_retention (singleton, pruned_through)
		select true, max(id) from deleted
		on conflict (singleton) do update
		set pruned_through = excluded.pruned_through
	`); err != nil {
		t.Fatal(err)
	}
	expired := getEventPage(t, h, authz, "/v1/events?after="+first.Events[0].ID+"&limit=200")
	if !expired.ResetRequired || len(expired.Events) != 0 || expired.HasMore {
		t.Fatalf("expired page=%+v", expired)
	}
	if expired.NextAfter != later.Events[0].ID {
		t.Fatalf("expired nextAfter=%q want %q", expired.NextAfter, later.Events[0].ID)
	}
	aheadID, err := strconv.ParseInt(later.Events[0].ID, 10, 64)
	if err != nil {
		t.Fatal(err)
	}
	ahead := getEventPage(t, h, authz, "/v1/events?after="+strconv.FormatInt(aheadID+100, 10)+"&limit=200")
	if !ahead.ResetRequired || ahead.NextAfter != later.Events[0].ID {
		t.Fatalf("ahead page=%+v", ahead)
	}
	legacy := getEventPage(t, h, authz, "/v1/events?after=0&limit=200")
	if legacy.ResetRequired || len(legacy.Events) != 1 {
		t.Fatalf("legacy zero cursor=%+v", legacy)
	}

	for _, after := range []string{"-1", "not-a-number", "9223372036854775808"} {
		res := doJSON(t, h, http.MethodGet, "/v1/events?after="+after, authz, nil)
		if res.Code != http.StatusBadRequest {
			t.Fatalf("after=%q status=%d body=%s", after, res.Code, res.Body)
		}
	}
	invalidLatestLimit := doJSON(t, h, http.MethodGet, "/v1/events?after=latest&limit=201", authz, nil)
	if invalidLatestLimit.Code != http.StatusBadRequest {
		t.Fatalf("latest invalid limit=%d body=%s", invalidLatestLimit.Code, invalidLatestLimit.Body)
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
