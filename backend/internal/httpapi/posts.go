package httpapi

import (
	"net/http"

	"github.com/google/uuid"
	openapi_types "github.com/oapi-codegen/runtime/types"
	"github.com/sudabon/PostAll/backend/internal/api"
	"github.com/sudabon/PostAll/backend/internal/auth"
	"github.com/sudabon/PostAll/backend/internal/post"
)

func (s *Server) ListChannelPosts(w http.ResponseWriter, r *http.Request, channelId api.ChannelId, params api.ListChannelPostsParams) {
	if !s.requirePosts(w) {
		return
	}
	viewerID, ok := authorFrom(w, r)
	if !ok {
		return
	}
	limit := 10
	if params.Limit != nil {
		limit = *params.Limit
	}
	var around *uuid.UUID
	if params.Around != nil {
		id := uuid.UUID(*params.Around)
		around = &id
	}
	res, err := s.posts.ListTimeline(r.Context(), uuid.UUID(channelId), limit, params.Before, around)
	if err != nil {
		writeAppError(w, err)
		return
	}
	out, err := s.toAPIPosts(r.Context(), res.Posts, viewerID)
	if err != nil {
		writeAppError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, api.PostList{Posts: out, NextBefore: res.NextBefore})
}

func (s *Server) CreateChannelPost(w http.ResponseWriter, r *http.Request, channelId api.ChannelId) {
	if !s.requirePosts(w) {
		return
	}
	author, ok := authorFrom(w, r)
	if !ok {
		return
	}
	var body api.CreateChannelPostJSONRequestBody
	if !decodeJSON(w, r, &body) {
		return
	}
	row, err := s.posts.Create(r.Context(), uuid.UUID(channelId), author, derefBody(body.Body), uuidList(body.AttachmentIds))
	if err != nil {
		writeAppError(w, err)
		return
	}
	out, err := s.toAPIPosts(r.Context(), []post.View{row}, author)
	if err != nil {
		writeAppError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, out[0])
}

func (s *Server) EditPost(w http.ResponseWriter, r *http.Request, postId api.PostId) {
	if !s.requirePosts(w) {
		return
	}
	viewerID, ok := authorFrom(w, r)
	if !ok {
		return
	}
	var body api.EditPostJSONRequestBody
	if !decodeJSON(w, r, &body) {
		return
	}
	row, err := s.posts.Edit(r.Context(), uuid.UUID(postId), body.Body, body.AttachmentIds)
	if err != nil {
		writeAppError(w, err)
		return
	}
	out, err := s.toAPIPosts(r.Context(), []post.View{row}, viewerID)
	if err != nil {
		writeAppError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, out[0])
}

func (s *Server) DeletePost(w http.ResponseWriter, r *http.Request, postId api.PostId) {
	if !s.requirePosts(w) {
		return
	}
	if err := s.posts.Delete(r.Context(), uuid.UUID(postId)); err != nil {
		writeAppError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) CreateReply(w http.ResponseWriter, r *http.Request, postId api.PostId) {
	if !s.requirePosts(w) {
		return
	}
	author, ok := authorFrom(w, r)
	if !ok {
		return
	}
	var body api.CreateReplyJSONRequestBody
	if !decodeJSON(w, r, &body) {
		return
	}
	row, err := s.posts.CreateReply(r.Context(), uuid.UUID(postId), author, derefBody(body.Body), uuidList(body.AttachmentIds))
	if err != nil {
		writeAppError(w, err)
		return
	}
	out, err := s.toAPIPosts(r.Context(), []post.View{row}, author)
	if err != nil {
		writeAppError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, out[0])
}

func (s *Server) GetThread(w http.ResponseWriter, r *http.Request, postId api.PostId) {
	if !s.requirePosts(w) {
		return
	}
	viewerID, ok := authorFrom(w, r)
	if !ok {
		return
	}
	th, err := s.posts.GetThread(r.Context(), uuid.UUID(postId))
	if err != nil {
		writeAppError(w, err)
		return
	}
	views := make([]post.View, 0, len(th.Replies)+1)
	views = append(views, th.Root)
	views = append(views, th.Replies...)
	out, err := s.toAPIPosts(r.Context(), views, viewerID)
	if err != nil {
		writeAppError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, api.Thread{Root: out[0], Replies: out[1:]})
}

func (s *Server) requirePosts(w http.ResponseWriter) bool {
	if s.posts != nil {
		return true
	}
	writeAPIError(w, http.StatusServiceUnavailable, "unavailable", "データベースに接続できません", nil)
	return false
}

func authorFrom(w http.ResponseWriter, r *http.Request) (uuid.UUID, bool) {
	p, ok := auth.PrincipalFrom(r.Context())
	if !ok {
		writeAPIError(w, http.StatusUnauthorized, "unauthorized", "認可情報を検証できませんでした", nil)
		return uuid.Nil, false
	}
	id, err := uuid.Parse(p.UserID)
	if err != nil {
		writeAPIError(w, http.StatusUnauthorized, "unauthorized", "認可情報を検証できませんでした", nil)
		return uuid.Nil, false
	}
	return id, true
}

func derefBody(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

func uuidList(ids *[]openapi_types.UUID) []uuid.UUID {
	if ids == nil {
		return nil
	}
	out := make([]uuid.UUID, 0, len(*ids))
	for _, id := range *ids {
		out = append(out, uuid.UUID(id))
	}
	return out
}

func toAPIPost(v post.View) api.Post {
	atts := make([]api.Attachment, 0, len(v.Attachments))
	for _, a := range v.Attachments {
		atts = append(atts, toAPIAttachment(a))
	}
	return api.Post{
		Id:           v.ID,
		ChannelId:    v.ChannelID,
		ThreadRootId: v.ThreadRootID,
		AuthorId:     v.AuthorID,
		Body:         v.Body,
		CreatedAt:    v.CreatedAt,
		UpdatedAt:    v.UpdatedAt,
		EditedAt:     v.EditedAt,
		Deleted:      v.Deleted,
		ReplyCount:   int(v.ReplyCount),
		LastReplyAt:  v.LastReplyAt,
		Attachments:  &atts,
	}
}
