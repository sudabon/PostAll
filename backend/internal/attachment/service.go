package attachment

import (
	"context"
	"errors"
	"fmt"
	"path"
	"strings"
	"time"
	"unicode"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/sudabon/PostAll/backend/internal/blob"
	"github.com/sudabon/PostAll/backend/internal/store"
)

type Service struct {
	q    *store.Queries
	blob blob.Store
}

func NewService(q *store.Queries, b blob.Store) *Service {
	return &Service{q: q, blob: b}
}

type View struct {
	ID          uuid.UUID
	PostID      *uuid.UUID
	FileName    string
	ContentType string
	SizeBytes   int64
	Checksum    string
	CreatedAt   time.Time
}

type StartResult struct {
	View    View
	URL     string
	Headers map[string]string
}

type DownloadResult struct {
	URL       string
	ExpiresAt time.Time
}

func (s *Service) Ready() bool {
	return s != nil && s.blob != nil
}

func (s *Service) Start(ctx context.Context, uploaderID uuid.UUID, fileName, contentType, checksum string, size int64) (StartResult, error) {
	if !s.Ready() {
		return StartResult{}, errUnavailable()
	}
	fileName = sanitizeName(fileName)
	if fileName == "" {
		return StartResult{}, errValidation("ファイル名が不正です")
	}
	if size <= 0 {
		return StartResult{}, errValidation("ファイルサイズが不正です")
	}
	if size > MaxBytes {
		return StartResult{}, errTooLarge()
	}
	if !Allowed(contentType) {
		return StartResult{}, errBadType()
	}
	if checksum == "" {
		return StartResult{}, errValidation("チェックサムが必要です")
	}
	id := uuid.New()
	key := "attachments/" + uploaderID.String() + "/" + id.String() + "/" + fileName
	row, err := s.q.InsertAttachment(ctx, store.InsertAttachmentParams{
		ID:          id,
		UploaderID:  uploaderID,
		FileName:    fileName,
		ContentType: contentType,
		SizeBytes:   size,
		StorageKey:  key,
		Checksum:    checksum,
	})
	if err != nil {
		return StartResult{}, err
	}
	url, headers, err := s.blob.PresignPut(ctx, row.StorageKey, contentType, size)
	if err != nil {
		return StartResult{}, err
	}
	return StartResult{View: fromRow(row), URL: url, Headers: headers}, nil
}

func (s *Service) Complete(ctx context.Context, id, uploaderID uuid.UUID) (View, error) {
	if !s.Ready() {
		return View{}, errUnavailable()
	}
	row, err := s.q.GetAttachment(ctx, id)
	if err != nil {
		return View{}, mapNotFound(err)
	}
	if row.UploaderID != uploaderID {
		return View{}, errForbidden("この添付を確定できません")
	}
	if row.CompletedAt != nil {
		return fromRow(row), nil
	}
	exists, size, err := s.blob.Head(ctx, row.StorageKey)
	if err != nil {
		return View{}, err
	}
	if !exists || size != row.SizeBytes {
		return View{}, errIncomplete()
	}
	done, err := s.q.CompleteAttachment(ctx, store.CompleteAttachmentParams{ID: id, UploaderID: uploaderID})
	if err != nil {
		return View{}, mapNotFound(err)
	}
	return fromRow(done), nil
}

func (s *Service) Download(ctx context.Context, id, userID uuid.UUID) (DownloadResult, error) {
	if !s.Ready() {
		return DownloadResult{}, errUnavailable()
	}
	row, err := s.q.GetAttachment(ctx, id)
	if err != nil {
		return DownloadResult{}, mapNotFound(err)
	}
	if row.CompletedAt == nil {
		return DownloadResult{}, errNotFound("添付が見つかりません")
	}
	if row.PostID == nil {
		if row.UploaderID != userID {
			return DownloadResult{}, errForbidden("この添付を取得できません")
		}
	} else {
		post, err := s.q.GetPost(ctx, *row.PostID)
		if err != nil {
			return DownloadResult{}, mapNotFound(err)
		}
		if post.DeletedAt != nil {
			return DownloadResult{}, errNotFound("添付が見つかりません")
		}
	}
	url, err := s.blob.PresignGet(ctx, row.StorageKey, row.FileName)
	if err != nil {
		return DownloadResult{}, err
	}
	return DownloadResult{URL: url, ExpiresAt: time.Now().Add(5 * time.Minute)}, nil
}

func (s *Service) ListForPost(ctx context.Context, postID uuid.UUID) ([]View, error) {
	rows, err := s.q.ListAttachmentsByPostID(ctx, &postID)
	if err != nil {
		return nil, err
	}
	out := make([]View, 0, len(rows))
	for _, row := range rows {
		out = append(out, fromRow(row))
	}
	return out, nil
}

func (s *Service) Bind(ctx context.Context, q *store.Queries, postID, uploaderID uuid.UUID, ids []uuid.UUID) error {
	if len(ids) > MaxPerPost {
		return errValidation("添付は 1 ポストあたり 10 件までです")
	}
	if q == nil {
		q = s.q
	}
	for _, id := range ids {
		n, err := q.BindAttachment(ctx, store.BindAttachmentParams{
			PostID:     &postID,
			ID:         id,
			UploaderID: uploaderID,
		})
		if err != nil {
			return err
		}
		if n == 0 {
			return errValidation("添付を紐付けできません")
		}
	}
	return nil
}

func (s *Service) Replace(ctx context.Context, q *store.Queries, postID, uploaderID uuid.UUID, ids []uuid.UUID) error {
	if q == nil {
		q = s.q
	}
	if err := q.UnbindByPostID(ctx, &postID); err != nil {
		return err
	}
	return s.Bind(ctx, q, postID, uploaderID, ids)
}

func (s *Service) Reap(ctx context.Context) error {
	if !s.Ready() {
		return nil
	}
	if err := s.q.MarkReapableAttachmentsPending(ctx, time.Now().Add(-IncompleteAge)); err != nil {
		return err
	}
	rows, err := s.q.ListPendingAttachments(ctx, 100)
	if err != nil {
		return err
	}
	var reapErrors []error
	for _, row := range rows {
		if err := s.blob.Delete(ctx, row.StorageKey); err != nil {
			reapErrors = append(reapErrors, err)
			if recordErr := s.q.RecordAttachmentDeletionFailure(ctx, store.RecordAttachmentDeletionFailureParams{
				ID:            row.ID,
				DeletionError: err.Error(),
			}); recordErr != nil {
				reapErrors = append(reapErrors, fmt.Errorf("record attachment %s deletion failure: %w", row.ID, recordErr))
			}
			continue
		}
		if err := s.q.DeleteAttachmentRow(ctx, row.ID); err != nil {
			reapErrors = append(reapErrors, fmt.Errorf("delete attachment %s row: %w", row.ID, err))
		}
	}
	return errors.Join(reapErrors...)
}

func fromRow(row store.Attachment) View {
	return View{
		ID:          row.ID,
		PostID:      row.PostID,
		FileName:    row.FileName,
		ContentType: row.ContentType,
		SizeBytes:   row.SizeBytes,
		Checksum:    row.Checksum,
		CreatedAt:   row.CreatedAt,
	}
}

func mapNotFound(err error) error {
	if err == pgx.ErrNoRows {
		return errNotFound("添付が見つかりません")
	}
	return err
}

func sanitizeName(name string) string {
	name = path.Base(strings.ReplaceAll(name, "\\", "/"))
	name = strings.TrimSpace(name)
	if name == "." || name == ".." {
		return ""
	}
	var b strings.Builder
	for _, r := range name {
		if unicode.IsControl(r) {
			continue
		}
		b.WriteRune(r)
	}
	out := strings.TrimSpace(b.String())
	if len(out) > 200 {
		out = out[:200]
	}
	return out
}
