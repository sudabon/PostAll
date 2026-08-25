package httpapi

import (
	"net/http"

	"github.com/google/uuid"
	"github.com/sudabon/PostAll/backend/internal/api"
	searchservice "github.com/sudabon/PostAll/backend/internal/search"
)

func (s *Server) SearchPosts(w http.ResponseWriter, r *http.Request, params api.SearchPostsParams) {
	if s.search == nil {
		writeAPIError(w, http.StatusServiceUnavailable, "unavailable", "データベースに接続できません", nil)
		return
	}
	limit := 20
	if params.Limit != nil {
		limit = *params.Limit
	}
	var channelID *uuid.UUID
	if params.ChannelId != nil {
		id := uuid.UUID(*params.ChannelId)
		channelID = &id
	}
	page, err := s.search.Search(r.Context(), searchservice.Input{
		Query: params.Q, ChannelID: channelID,
		CreatedFrom: params.CreatedFrom, CreatedTo: params.CreatedTo,
		Limit: limit, Cursor: params.Cursor,
	})
	if err != nil {
		writeAppError(w, r, err)
		return
	}
	results := make([]api.SearchResult, 0, len(page.Results))
	for _, item := range page.Results {
		results = append(results, api.SearchResult{
			PostId: item.PostID, TimelinePostId: item.TimelinePostID,
			ChannelId: item.ChannelID, ChannelName: item.ChannelName,
			ThreadRootId: item.ThreadRootID, Body: item.Body, CreatedAt: item.CreatedAt,
		})
	}
	writeJSON(w, http.StatusOK, api.SearchResultPage{Results: results, NextCursor: page.NextCursor})
}
