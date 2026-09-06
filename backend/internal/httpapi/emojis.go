package httpapi

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"strconv"

	"github.com/google/uuid"
	openapi_types "github.com/oapi-codegen/runtime/types"
	"github.com/sudabon/PostAll/backend/internal/api"
	"github.com/sudabon/PostAll/backend/internal/blob"
	"github.com/sudabon/PostAll/backend/internal/emoji"
	"github.com/sudabon/PostAll/backend/internal/post"
)

func (s *Server) ListEmojis(w http.ResponseWriter, r *http.Request) {
	if !s.requireEmojis(w) {
		return
	}
	items, err := s.emojis.List(r.Context())
	if err != nil {
		writeAppError(w, r, err)
		return
	}
	out := make([]api.Emoji, 0, len(items))
	for _, item := range items {
		out = append(out, toAPIEmoji(item))
	}
	writeJSON(w, http.StatusOK, api.EmojiList{Emojis: out})
}

// createEmojiEnvelopeSlack は multipart の包み（境界文字列とパートのヘッダ）の分。
// 画像そのものの上限は emoji.MaxImageBytes で、実体のサイズは Register が判定する。
const createEmojiEnvelopeSlack = 64 * 1024

func (s *Server) CreateEmoji(w http.ResponseWriter, r *http.Request) {
	if !s.requireEmojis(w) {
		return
	}
	if _, ok := authorFrom(w, r); !ok {
		return
	}

	limit := int64(emoji.MaxImageBytes + createEmojiEnvelopeSlack)
	r.Body = http.MaxBytesReader(w, r.Body, limit)
	if err := r.ParseMultipartForm(limit); err != nil {
		writeUploadReadError(w, r, err)
		return
	}
	defer func() { _ = r.MultipartForm.RemoveAll() }()

	var image []byte
	file, _, err := r.FormFile("file")
	switch {
	case errors.Is(err, http.ErrMissingFile):
		// image は nil のまま。Register が「画像ファイルを選んでください」を返す。
	case err != nil:
		writeUploadReadError(w, r, err)
		return
	default:
		defer func() { _ = file.Close() }()
		if image, err = io.ReadAll(file); err != nil {
			writeUploadReadError(w, r, err)
			return
		}
	}

	item, err := s.emojis.Register(r.Context(), s.emojiBlobs, r.FormValue("shortcode"), image)
	if err != nil {
		writeAppError(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, toAPIEmoji(item))
}

func writeUploadReadError(w http.ResponseWriter, r *http.Request, err error) {
	var tooLarge *http.MaxBytesError
	if errors.As(err, &tooLarge) {
		writeAppError(w, r, emoji.ErrImageTooLarge())
		return
	}
	writeAPIError(w, http.StatusBadRequest, "invalid_request", "アップロードの内容を読み取れませんでした", nil)
}

func (s *Server) GetEmojiImage(w http.ResponseWriter, r *http.Request, shortcode api.EmojiShortcode) {
	if !s.requireEmojis(w) {
		return
	}
	item, err := s.emojis.GetByShortcode(r.Context(), string(shortcode))
	if err != nil {
		writeAppError(w, r, err)
		return
	}
	etag := strconv.Quote(item.Checksum)
	w.Header().Set("Cache-Control", "private, max-age=60")
	w.Header().Set("ETag", etag)
	if s.emojiBlobs == nil {
		writeEmojiImageNotFound(w)
		return
	}
	exists, _, err := s.emojiBlobs.Head(r.Context(), item.StorageKey)
	if err != nil {
		writeInternal(w, r, err)
		return
	}
	if !exists {
		writeEmojiImageNotFound(w)
		return
	}
	if r.Header.Get("If-None-Match") == etag {
		w.WriteHeader(http.StatusNotModified)
		return
	}
	// 署名付き URL へリダイレクトすると、ブラウザがクレデンシャル付きのまま
	// クロスオリジンでストレージを読みに行くことになり CORS と署名の両方に依存する。
	// OpenAPI の定義どおり、この API が画像そのものを返す。
	body, contentType, size, err := s.emojiBlobs.Get(r.Context(), item.StorageKey)
	if err != nil {
		if errors.Is(err, blob.ErrNotFound) {
			writeEmojiImageNotFound(w)
			return
		}
		writeInternal(w, r, err)
		return
	}
	defer func() { _ = body.Close() }()
	if contentType == "" {
		contentType = "image/png"
	}
	w.Header().Set("Content-Type", contentType)
	if size >= 0 {
		w.Header().Set("Content-Length", strconv.FormatInt(size, 10))
	}
	w.WriteHeader(http.StatusOK)
	if _, err := io.Copy(w, body); err != nil {
		// ヘッダ送信後なのでステータスは変えられない。記録だけ残す。
		slog.WarnContext(r.Context(), "emoji image streaming failed",
			"shortcode", string(shortcode), "error", safeLogError(err))
	}
}

func (s *Server) AddReaction(w http.ResponseWriter, r *http.Request, postId api.PostId, emojiId api.EmojiId) {
	if !s.requireEmojis(w) {
		return
	}
	userID, ok := authorFrom(w, r)
	if !ok {
		return
	}
	summary, err := s.emojis.AddReaction(r.Context(), uuid.UUID(postId), uuid.UUID(emojiId), userID)
	if err != nil {
		writeAppError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, toAPIReaction(summary, userID))
}

func (s *Server) RemoveReaction(w http.ResponseWriter, r *http.Request, postId api.PostId, emojiId api.EmojiId) {
	if !s.requireEmojis(w) {
		return
	}
	userID, ok := authorFrom(w, r)
	if !ok {
		return
	}
	if err := s.emojis.RemoveReaction(r.Context(), uuid.UUID(postId), uuid.UUID(emojiId), userID); err != nil {
		writeAppError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) requireEmojis(w http.ResponseWriter) bool {
	if s.emojis != nil {
		return true
	}
	writeAPIError(w, http.StatusServiceUnavailable, "unavailable", "データベースに接続できません", nil)
	return false
}

func (s *Server) toAPIPosts(ctx context.Context, views []post.View, viewerID uuid.UUID) ([]api.Post, error) {
	postIDs := make([]uuid.UUID, 0, len(views))
	for _, view := range views {
		postIDs = append(postIDs, view.ID)
	}
	grouped, err := s.emojis.ListReactionsForPosts(ctx, postIDs)
	if err != nil {
		return nil, err
	}
	out := make([]api.Post, 0, len(views))
	for _, view := range views {
		item := toAPIPost(view)
		reactions := make([]api.Reaction, 0, len(grouped[view.ID]))
		for _, summary := range grouped[view.ID] {
			reactions = append(reactions, toAPIReaction(summary, viewerID))
		}
		item.Reactions = &reactions
		out = append(out, item)
	}
	return out, nil
}

func toAPIEmoji(item emoji.CatalogItem) api.Emoji {
	return api.Emoji{
		Id:        item.ID,
		Shortcode: item.Shortcode,
		ImagePath: "/v1/emojis/" + url.PathEscape(item.Shortcode) + "/image",
		Checksum:  item.Checksum,
	}
}

func toAPIReaction(summary emoji.ReactionSummary, viewerID uuid.UUID) api.Reaction {
	reactors := make([]openapi_types.UUID, 0, len(summary.ReactorIDs))
	reactedByMe := false
	for _, reactorID := range summary.ReactorIDs {
		if reactorID == viewerID {
			reactedByMe = true
			reactors = append(reactors, reactorID)
		}
	}
	for _, reactorID := range summary.ReactorIDs {
		if reactorID != viewerID {
			reactors = append(reactors, reactorID)
		}
	}
	return api.Reaction{
		Emoji:       toAPIEmoji(summary.Emoji),
		Count:       len(reactors),
		ReactedByMe: reactedByMe,
		ReactorIds:  reactors,
	}
}

func writeEmojiImageNotFound(w http.ResponseWriter) {
	writeAPIError(w, http.StatusNotFound, "not_found", "絵文字画像が見つかりません", nil)
}
