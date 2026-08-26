package httpapi

import (
	"net/http"
	"strconv"

	"github.com/sudabon/PostAll/backend/internal/api"
	changeservice "github.com/sudabon/PostAll/backend/internal/change"
)

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
