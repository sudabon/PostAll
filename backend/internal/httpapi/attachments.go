package httpapi

import (
	"net/http"

	"github.com/google/uuid"
	"github.com/sudabon/PostAll/backend/internal/api"
	"github.com/sudabon/PostAll/backend/internal/attachment"
)

func (s *Server) StartAttachmentUpload(w http.ResponseWriter, r *http.Request) {
	if !s.requireAttachments(w) {
		return
	}
	author, ok := authorFrom(w, r)
	if !ok {
		return
	}
	var body api.StartAttachmentUploadJSONRequestBody
	if !decodeJSON(w, r, &body) {
		return
	}
	res, err := s.attachments.Start(r.Context(), author, body.FileName, body.ContentType, body.Checksum, body.SizeBytes)
	if err != nil {
		writeAppError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, api.StartUploadResponse{
		Id:        res.View.ID,
		UploadUrl: res.URL,
		Headers:   res.Headers,
	})
}

func (s *Server) CompleteAttachment(w http.ResponseWriter, r *http.Request, attachmentId api.AttachmentId) {
	if !s.requireAttachments(w) {
		return
	}
	author, ok := authorFrom(w, r)
	if !ok {
		return
	}
	view, err := s.attachments.Complete(r.Context(), uuid.UUID(attachmentId), author)
	if err != nil {
		writeAppError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, toAPIAttachment(view))
}

func (s *Server) GetAttachmentDownload(w http.ResponseWriter, r *http.Request, attachmentId api.AttachmentId) {
	if !s.requireAttachments(w) {
		return
	}
	author, ok := authorFrom(w, r)
	if !ok {
		return
	}
	res, err := s.attachments.Download(r.Context(), uuid.UUID(attachmentId), author)
	if err != nil {
		writeAppError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, api.DownloadUrlResponse{Url: res.URL, ExpiresAt: res.ExpiresAt})
}

func (s *Server) requireAttachments(w http.ResponseWriter) bool {
	if s.attachments != nil && s.attachments.Ready() {
		return true
	}
	writeAPIError(w, http.StatusServiceUnavailable, "unavailable", "添付ストレージを利用できません", nil)
	return false
}

func toAPIAttachment(v attachment.View) api.Attachment {
	return api.Attachment{
		Id:          v.ID,
		PostId:      v.PostID,
		FileName:    v.FileName,
		ContentType: v.ContentType,
		SizeBytes:   v.SizeBytes,
		Checksum:    v.Checksum,
		CreatedAt:   v.CreatedAt,
	}
}
