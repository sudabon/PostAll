package httpapi

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/sudabon/PostAll/backend/internal/api"
	changeservice "github.com/sudabon/PostAll/backend/internal/change"
)

const eventHeartbeatInterval = 15 * time.Second

func (s *Server) ListChangeEvents(w http.ResponseWriter, r *http.Request, params api.ListChangeEventsParams) {
	if s.changes == nil {
		writeAPIError(w, http.StatusServiceUnavailable, "unavailable", "データベースに接続できません", nil)
		return
	}
	after := int64(0)
	if params.After != nil {
		parsed, err := strconv.ParseInt(*params.After, 10, 64)
		if err != nil || parsed < 0 {
			writeAPIError(w, http.StatusBadRequest, "validation", "イベント ID が不正です", nil)
			return
		}
		after = parsed
	}
	limit := 100
	if params.Limit != nil {
		limit = *params.Limit
	}
	if limit < 1 || limit > 200 {
		writeAPIError(w, http.StatusBadRequest, "validation", "取得件数が不正です", nil)
		return
	}

	page, err := s.changes.ListAfter(r.Context(), after, limit)
	if err != nil {
		writeInternal(w, r, err)
		return
	}
	events := make([]api.ChangeEvent, 0, len(page.Events))
	for _, event := range page.Events {
		events = append(events, toAPIChangeEvent(event))
	}
	writeJSON(w, http.StatusOK, api.ChangeEventPage{
		Events:    events,
		NextAfter: strconv.FormatInt(page.NextAfter, 10),
		HasMore:   page.HasMore,
	})
}

func (s *Server) StreamChangeEvents(w http.ResponseWriter, r *http.Request, params api.StreamChangeEventsParams) {
	if s.changes == nil || s.events == nil {
		writeAPIError(w, http.StatusServiceUnavailable, "unavailable", "データベースに接続できません", nil)
		return
	}
	lastID := int64(0)
	replay := params.LastEventID != nil
	if replay {
		parsed, err := strconv.ParseInt(*params.LastEventID, 10, 64)
		if err != nil || parsed < 0 {
			writeAPIError(w, http.StatusBadRequest, "validation", "イベント ID が不正です", nil)
			return
		}
		lastID = parsed
	}

	flusher, ok := w.(http.Flusher)
	if !ok {
		writeAPIError(w, http.StatusInternalServerError, "streaming_unavailable", "イベントストリームを開始できません", nil)
		return
	}
	wake, unsubscribe, err := s.events.Subscribe(r.Context())
	if err != nil {
		writeInternal(w, r, err)
		return
	}
	defer unsubscribe()
	if !replay {
		lastID, err = s.changes.LatestID(r.Context())
		if err != nil {
			writeInternal(w, r, err)
			return
		}
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)
	flusher.Flush()

	if replay {
		if err := s.writePendingEvents(r.Context(), w, flusher, &lastID); err != nil {
			return
		}
	} else if err := writeSyncEvent(w, flusher, lastID); err != nil {
		return
	}
	heartbeat := time.NewTicker(eventHeartbeatInterval)
	defer heartbeat.Stop()
	for {
		select {
		case <-r.Context().Done():
			return
		case _, ok := <-wake:
			if !ok {
				return
			}
			if err := s.writePendingEvents(r.Context(), w, flusher, &lastID); err != nil {
				return
			}
		case <-heartbeat.C:
			if err := s.writePendingEvents(r.Context(), w, flusher, &lastID); err != nil {
				return
			}
			if _, err := fmt.Fprint(w, ": heartbeat\n\n"); err != nil {
				return
			}
			flusher.Flush()
		}
	}
}

func writeSyncEvent(w http.ResponseWriter, flusher http.Flusher, watermark int64) error {
	id := strconv.FormatInt(watermark, 10)
	body, err := json.Marshal(api.ChangeEvent{
		Id:        id,
		EventType: api.ChangeEventEventType("post.updated"),
		CreatedAt: time.Now().UTC(),
	})
	if err != nil {
		return err
	}
	if _, err := fmt.Fprintf(w, "id: %s\nevent: postall.sync\ndata: %s\n\n", id, body); err != nil {
		return err
	}
	flusher.Flush()
	return nil
}

func (s *Server) writePendingEvents(
	ctx context.Context,
	w http.ResponseWriter,
	flusher http.Flusher,
	after *int64,
) error {
	for {
		page, err := s.changes.ListAfter(ctx, *after, 200)
		if err != nil {
			return err
		}
		for _, event := range page.Events {
			body, err := json.Marshal(toAPIChangeEvent(event))
			if err != nil {
				return err
			}
			if _, err := fmt.Fprintf(w, "id: %d\nevent: %s\ndata: %s\n\n", event.ID, event.EventType, body); err != nil {
				return err
			}
			flusher.Flush()
			*after = event.ID
		}
		if !page.HasMore {
			return nil
		}
	}
}

func toAPIChangeEvent(event changeservice.Event) api.ChangeEvent {
	return api.ChangeEvent{
		Id:           strconv.FormatInt(event.ID, 10),
		EventType:    api.ChangeEventEventType(event.EventType),
		ChannelId:    event.ChannelID,
		PostId:       event.PostID,
		ThreadRootId: event.ThreadRootID,
		CreatedAt:    event.CreatedAt,
	}
}
