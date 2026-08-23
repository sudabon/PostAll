package httpapi

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"

	"github.com/google/uuid"
	"github.com/sudabon/PostAll/backend/internal/api"
	"github.com/sudabon/PostAll/backend/internal/attachment"
	"github.com/sudabon/PostAll/backend/internal/channel"
	"github.com/sudabon/PostAll/backend/internal/emoji"
	"github.com/sudabon/PostAll/backend/internal/post"
	searchservice "github.com/sudabon/PostAll/backend/internal/search"
	"github.com/sudabon/PostAll/backend/internal/store"
)

func (s *Server) ListChannels(w http.ResponseWriter, r *http.Request) {
	if !s.requireChannels(w) {
		return
	}
	rows, err := s.channels.List(r.Context())
	if err != nil {
		writeInternal(w)
		return
	}
	out := make([]api.Channel, 0, len(rows))
	for _, row := range rows {
		out = append(out, toAPIChannel(row))
	}
	writeJSON(w, http.StatusOK, api.ChannelList{Channels: out})
}

func (s *Server) CreateChannel(w http.ResponseWriter, r *http.Request) {
	if !s.requireChannels(w) {
		return
	}
	var body api.CreateChannelJSONRequestBody
	if !decodeJSON(w, r, &body) {
		return
	}
	row, err := s.channels.Create(r.Context(), body.Name, body.ParentId)
	if err != nil {
		writeChannelError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, toAPIChannel(row))
}

func (s *Server) RenameChannel(w http.ResponseWriter, r *http.Request, channelId api.ChannelId) {
	if !s.requireChannels(w) {
		return
	}
	var body api.RenameChannelJSONRequestBody
	if !decodeJSON(w, r, &body) {
		return
	}
	row, err := s.channels.Rename(r.Context(), uuid.UUID(channelId), body.Name)
	if err != nil {
		writeChannelError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, toAPIChannel(row))
}

func (s *Server) MoveChannel(w http.ResponseWriter, r *http.Request, channelId api.ChannelId) {
	if !s.requireChannels(w) {
		return
	}
	var body api.MoveChannelJSONRequestBody
	if !decodeJSON(w, r, &body) {
		return
	}
	row, err := s.channels.Move(r.Context(), uuid.UUID(channelId), channel.MoveInput{
		ParentID: body.ParentId,
		BeforeID: body.BeforeId,
		AfterID:  body.AfterId,
	})
	if err != nil {
		writeChannelError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, toAPIChannel(row))
}

func (s *Server) DeleteChannel(w http.ResponseWriter, r *http.Request, channelId api.ChannelId) {
	if !s.requireChannels(w) {
		return
	}
	if err := s.channels.Delete(r.Context(), uuid.UUID(channelId)); err != nil {
		writeChannelError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) requireChannels(w http.ResponseWriter) bool {
	if s.channels != nil {
		return true
	}
	writeAPIError(w, http.StatusServiceUnavailable, "unavailable", "データベースに接続できません", nil)
	return false
}

func decodeJSON(w http.ResponseWriter, r *http.Request, dst any) bool {
	dec := json.NewDecoder(io.LimitReader(r.Body, 1<<20))
	if err := dec.Decode(dst); err != nil {
		writeAPIError(w, http.StatusBadRequest, "validation", "リクエストが不正です", nil)
		return false
	}
	return true
}

func writeChannelError(w http.ResponseWriter, err error) {
	writeAppError(w, err)
}

func writeAppError(w http.ResponseWriter, err error) {
	var ce *channel.Error
	if errors.As(err, &ce) {
		writeAPIError(w, ce.Status, ce.Code, ce.Message, ce.Details)
		return
	}
	var pe *post.Error
	if errors.As(err, &pe) {
		writeAPIError(w, pe.Status, pe.Code, pe.Message, pe.Details)
		return
	}
	var ae *attachment.Error
	if errors.As(err, &ae) {
		writeAPIError(w, ae.Status, ae.Code, ae.Message, ae.Details)
		return
	}
	var ee *emoji.Error
	if errors.As(err, &ee) {
		writeAPIError(w, ee.Status, ee.Code, ee.Message, nil)
		return
	}
	var se *searchservice.Error
	if errors.As(err, &se) {
		writeAPIError(w, se.Status, se.Code, se.Message, nil)
		return
	}
	writeInternal(w)
}

func writeInternal(w http.ResponseWriter) {
	writeAPIError(w, http.StatusInternalServerError, "internal", "内部エラーが発生しました", nil)
}

func toAPIChannel(row store.Channel) api.Channel {
	return api.Channel{
		Id:        row.ID,
		ParentId:  row.ParentID,
		Name:      row.Name,
		SortKey:   row.SortKey,
		CreatedAt: row.CreatedAt,
		UpdatedAt: row.UpdatedAt,
	}
}
