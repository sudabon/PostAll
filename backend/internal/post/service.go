package post

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/sudabon/PostAll/backend/internal/attachment"
	"github.com/sudabon/PostAll/backend/internal/encryption"
	"github.com/sudabon/PostAll/backend/internal/store"
)

const defaultLimit = 10
const maxLimit = 50

type Service struct {
	q           *store.Queries
	pool        *pgxpool.Pool
	attachments *attachment.Service
}

func NewService(q *store.Queries, pool *pgxpool.Pool, attachments *attachment.Service) *Service {
	return &Service{q: q, pool: pool, attachments: attachments}
}

type View struct {
	ID           uuid.UUID
	ChannelID    uuid.UUID
	ThreadRootID *uuid.UUID
	AuthorID     uuid.UUID
	Body         string
	Encrypted    bool
	Ciphertext   *string
	CreatedAt    time.Time
	UpdatedAt    time.Time
	EditedAt     *time.Time
	Deleted      bool
	ReplyCount   int64
	LastReplyAt  *time.Time
	Attachments  []attachment.View
}

type ListResult struct {
	Posts      []View
	NextBefore *string
}

type Thread struct {
	Root    View
	Replies []View
}

// Content は作成・返信・編集で受け取る本文。暗号化チャネルでは Body を空にし、Ciphertext を渡す。
type Content struct {
	Body       string
	Ciphertext *string
}

func (s *Service) Create(ctx context.Context, channelID, authorID uuid.UUID, content Content, attachmentIDs []uuid.UUID) (View, error) {
	channel, err := s.q.GetChannel(ctx, channelID)
	if err != nil {
		return View{}, mapNotFound(err, "チャネルが見つかりません")
	}
	content, err = s.checkContent(ctx, channel.Encrypted, content, len(attachmentIDs))
	if err != nil {
		return View{}, err
	}
	return s.insert(ctx, channelID, nil, authorID, channel.Encrypted, content, attachmentIDs)
}

func (s *Service) ListTimeline(ctx context.Context, channelID uuid.UUID, limit int, before *string, around *uuid.UUID) (ListResult, error) {
	if _, err := s.q.GetChannel(ctx, channelID); err != nil {
		return ListResult{}, mapNotFound(err, "チャネルが見つかりません")
	}
	if limit <= 0 {
		limit = defaultLimit
	}
	if limit > maxLimit {
		limit = maxLimit
	}
	fetch := int32(limit + 1)
	var rows []store.ListTimelineLatestRow
	var err error
	if before != nil && *before != "" && around != nil {
		return ListResult{}, errValidation("before と around は同時に指定できません")
	}
	if around != nil {
		target, getErr := s.q.GetPost(ctx, *around)
		if getErr != nil {
			return ListResult{}, mapNotFound(getErr, "ポストが見つかりません")
		}
		if target.ChannelID != channelID || target.ThreadRootID != nil || target.DeletedAt != nil {
			return ListResult{}, errNotFound("ポストが見つかりません")
		}
		var aroundRows []store.ListTimelineAroundRow
		aroundRows, err = s.q.ListTimelineAround(ctx, store.ListTimelineAroundParams{
			AroundID: *around, ChannelID: channelID, RowLimit: fetch,
		})
		if err == nil {
			rows = aroundToLatest(aroundRows)
		}
	} else if before == nil || *before == "" {
		rows, err = s.q.ListTimelineLatest(ctx, store.ListTimelineLatestParams{
			ChannelID: channelID,
			RowLimit:  fetch,
		})
	} else {
		ts, id, cerr := DecodeCursor(*before)
		if cerr != nil {
			return ListResult{}, errValidation("カーソルが不正です")
		}
		var older []store.ListTimelineBeforeRow
		older, err = s.q.ListTimelineBefore(ctx, store.ListTimelineBeforeParams{
			ChannelID:       channelID,
			BeforeCreatedAt: ts,
			BeforeID:        id,
			RowLimit:        fetch,
		})
		if err == nil {
			rows = beforeToLatest(older)
		}
	}
	if err != nil {
		return ListResult{}, err
	}
	hasOlder := len(rows) > limit
	if hasOlder {
		rows = rows[:limit]
	}
	for i, j := 0, len(rows)-1; i < j; i, j = i+1, j-1 {
		rows[i], rows[j] = rows[j], rows[i]
	}
	out := make([]View, 0, len(rows))
	for _, row := range rows {
		out = append(out, fromLatest(row))
	}
	if err := s.hydrateAll(ctx, out); err != nil {
		return ListResult{}, err
	}
	res := ListResult{Posts: out}
	if hasOlder && len(out) > 0 {
		cur := EncodeCursor(out[0].CreatedAt, out[0].ID)
		res.NextBefore = &cur
	}
	return res, nil
}

func (s *Service) Edit(ctx context.Context, id uuid.UUID, content Content, attachmentIDs *[]uuid.UUID) (View, error) {
	current, err := s.q.GetPost(ctx, id)
	if err != nil {
		return View{}, mapNotFound(err, "ポストが見つかりません")
	}
	if current.DeletedAt != nil {
		return View{}, errDeleted()
	}
	nAttach := 0
	if attachmentIDs != nil {
		nAttach = len(*attachmentIDs)
	} else if s.attachments != nil {
		existing, err := s.attachments.ListForPost(ctx, id)
		if err != nil {
			return View{}, err
		}
		nAttach = len(existing)
	}
	content, err = s.checkContent(ctx, current.Encrypted, content, nAttach)
	if err != nil {
		return View{}, err
	}
	update := store.UpdatePostBodyParams{ID: id, Body: content.Body, BodyCiphertext: textOf(content.Ciphertext)}
	if attachmentIDs != nil && s.pool != nil && s.attachments != nil {
		tx, err := s.pool.Begin(ctx)
		if err != nil {
			return View{}, err
		}
		defer func() { _ = tx.Rollback(ctx) }()
		q := s.q.WithTx(tx)
		row, err := q.UpdatePostBody(ctx, update)
		if err != nil {
			_ = tx.Rollback(ctx)
			return View{}, mapWrite(ctx, s, id, err)
		}
		if err := s.attachments.Replace(ctx, q, id, row.AuthorID, *attachmentIDs); err != nil {
			return View{}, err
		}
		if err := tx.Commit(ctx); err != nil {
			return View{}, err
		}
		return s.viewOf(ctx, row)
	}
	row, err := s.q.UpdatePostBody(ctx, update)
	if err != nil {
		return View{}, mapWrite(ctx, s, id, err)
	}
	if attachmentIDs != nil && s.attachments != nil {
		if err := s.attachments.Replace(ctx, s.q, id, row.AuthorID, *attachmentIDs); err != nil {
			return View{}, err
		}
	}
	return s.viewOf(ctx, row)
}

func (s *Service) Delete(ctx context.Context, id uuid.UUID) error {
	_, err := s.q.SoftDeletePost(ctx, id)
	if err != nil {
		return mapWrite(ctx, s, id, err)
	}
	return nil
}

// CreateReply は親と同じチャネルに返信を作る。posts.encrypted はチャネルの値の複製なので、
// 親の値でスレッドの暗号化の有無が決まる。
func (s *Service) CreateReply(ctx context.Context, postID, authorID uuid.UUID, content Content, attachmentIDs []uuid.UUID) (View, error) {
	parent, err := s.q.GetPost(ctx, postID)
	if err != nil {
		return View{}, mapNotFound(err, "ポストが見つかりません")
	}
	content, err = s.checkContent(ctx, parent.Encrypted, content, len(attachmentIDs))
	if err != nil {
		return View{}, err
	}
	rootID := parent.ID
	if parent.ThreadRootID != nil {
		rootID = *parent.ThreadRootID
	}
	return s.insert(ctx, parent.ChannelID, &rootID, authorID, parent.Encrypted, content, attachmentIDs)
}

func (s *Service) GetThread(ctx context.Context, postID uuid.UUID) (Thread, error) {
	target, err := s.q.GetPost(ctx, postID)
	if err != nil {
		return Thread{}, mapNotFound(err, "ポストが見つかりません")
	}
	rootID := target.ID
	if target.ThreadRootID != nil {
		rootID = *target.ThreadRootID
	}
	root, err := s.q.GetPost(ctx, rootID)
	if err != nil {
		return Thread{}, mapNotFound(err, "ポストが見つかりません")
	}
	replies, err := s.q.ListThreadReplies(ctx, rootID)
	if err != nil {
		return Thread{}, err
	}
	rootView, err := s.viewOf(ctx, root)
	if err != nil {
		return Thread{}, err
	}
	out := make([]View, 0, len(replies))
	for _, row := range replies {
		out = append(out, fromReply(row))
	}
	if err := s.hydrateAll(ctx, out); err != nil {
		return Thread{}, err
	}
	return Thread{Root: rootView, Replies: out}, nil
}

func (s *Service) insert(ctx context.Context, channelID uuid.UUID, threadRootID *uuid.UUID, authorID uuid.UUID, encrypted bool, content Content, attachmentIDs []uuid.UUID) (View, error) {
	params := store.InsertPostParams{
		ChannelID:      channelID,
		ThreadRootID:   threadRootID,
		AuthorID:       authorID,
		Body:           content.Body,
		Encrypted:      encrypted,
		BodyCiphertext: textOf(content.Ciphertext),
	}
	if len(attachmentIDs) == 0 || s.pool == nil || s.attachments == nil {
		if len(attachmentIDs) > 0 {
			return View{}, errValidation("添付を利用できません")
		}
		row, err := s.q.InsertPost(ctx, params)
		if err != nil {
			return View{}, err
		}
		return s.hydrate(ctx, fromPost(row, 0, nil))
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return View{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := s.q.WithTx(tx)
	row, err := q.InsertPost(ctx, params)
	if err != nil {
		return View{}, err
	}
	if err := s.attachments.Bind(ctx, q, row.ID, authorID, attachmentIDs); err != nil {
		return View{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return View{}, err
	}
	return s.hydrate(ctx, fromPost(row, 0, nil))
}

func (s *Service) viewOf(ctx context.Context, row store.Post) (View, error) {
	n, err := s.q.CountReplies(ctx, row.ID)
	if err != nil {
		return View{}, err
	}
	last, err := s.q.LastReplyAt(ctx, row.ID)
	if errors.Is(err, pgx.ErrNoRows) {
		return s.hydrate(ctx, fromPost(row, n, nil))
	}
	if err != nil {
		return View{}, err
	}
	return s.hydrate(ctx, fromPost(row, n, &last))
}

func (s *Service) hydrate(ctx context.Context, v View) (View, error) {
	if v.Attachments == nil {
		v.Attachments = []attachment.View{}
	}
	if s.attachments == nil || v.Deleted {
		return v, nil
	}
	items, err := s.attachments.ListForPost(ctx, v.ID)
	if err != nil {
		return View{}, err
	}
	v.Attachments = items
	return v, nil
}

func (s *Service) hydrateAll(ctx context.Context, views []View) error {
	for i := range views {
		v, err := s.hydrate(ctx, views[i])
		if err != nil {
			return err
		}
		views[i] = v
	}
	return nil
}

// checkContent は、検証規則（validateContent）に加えて、暗号文の鍵 ID が鍵束と一致することを確かめる。
func (s *Service) checkContent(ctx context.Context, encrypted bool, content Content, nAttach int) (Content, error) {
	keyID, err := validateContent(encrypted, content, nAttach)
	if err != nil || !encrypted {
		return content, err
	}
	keyring, err := s.q.GetEncryptionKeyring(ctx)
	if errors.Is(err, pgx.ErrNoRows) {
		return Content{}, errEncryptionNotConfigured()
	}
	if err != nil {
		return Content{}, err
	}
	if keyring.KeyID != keyID {
		return Content{}, errInvalidCiphertext()
	}
	return content, nil
}

// validateContent は、チャネルの暗号化の有無に応じて平文と暗号文のどちらか一方だけを受け付ける。
// 暗号化チャネルでは、暗号文に埋め込まれた鍵 ID を返す。
func validateContent(encrypted bool, content Content, nAttach int) (uuid.UUID, error) {
	if !encrypted {
		if content.Ciphertext != nil {
			return uuid.Nil, errEncryptionNotAllowed()
		}
		if strings.TrimSpace(content.Body) == "" && nAttach == 0 {
			return uuid.Nil, errEmptyContent()
		}
		return uuid.Nil, nil
	}
	if content.Ciphertext == nil || content.Body != "" {
		return uuid.Nil, errEncryptionRequired()
	}
	if nAttach > 0 {
		return uuid.Nil, errEncryptedAttachments()
	}
	keyID, ok := encryption.EnvelopeKeyID(*content.Ciphertext)
	if !ok {
		return uuid.Nil, errInvalidCiphertext()
	}
	return keyID, nil
}

func textOf(s *string) pgtype.Text {
	if s == nil {
		return pgtype.Text{}
	}
	return pgtype.Text{String: *s, Valid: true}
}

// ciphertextOf は応答に載せる暗号文を返す。削除済みのポストでは返さない。
func ciphertextOf(t pgtype.Text, deleted bool) *string {
	if !t.Valid || deleted {
		return nil
	}
	s := t.String
	return &s
}

func mapNotFound(err error, msg string) error {
	if errors.Is(err, pgx.ErrNoRows) {
		return errNotFound(msg)
	}
	return err
}

func mapWrite(ctx context.Context, s *Service, id uuid.UUID, err error) error {
	if !errors.Is(err, pgx.ErrNoRows) {
		return err
	}
	existing, getErr := s.q.GetPost(ctx, id)
	if getErr != nil {
		return mapNotFound(getErr, "ポストが見つかりません")
	}
	if existing.DeletedAt != nil {
		return errDeleted()
	}
	return errNotFound("ポストが見つかりません")
}

func fromPost(row store.Post, replies int64, last *time.Time) View {
	v := View{
		ID:           row.ID,
		ChannelID:    row.ChannelID,
		ThreadRootID: row.ThreadRootID,
		AuthorID:     row.AuthorID,
		Body:         row.Body,
		Encrypted:    row.Encrypted,
		Ciphertext:   ciphertextOf(row.BodyCiphertext, row.DeletedAt != nil),
		CreatedAt:    row.CreatedAt,
		UpdatedAt:    row.UpdatedAt,
		EditedAt:     row.EditedAt,
		Deleted:      row.DeletedAt != nil,
		ReplyCount:   replies,
		LastReplyAt:  last,
		Attachments:  []attachment.View{},
	}
	if v.Deleted {
		v.Body = ""
	}
	return v
}

func fromLatest(row store.ListTimelineLatestRow) View {
	return View{
		ID:           row.ID,
		ChannelID:    row.ChannelID,
		ThreadRootID: row.ThreadRootID,
		AuthorID:     row.AuthorID,
		Body:         row.Body,
		Encrypted:    row.Encrypted,
		Ciphertext:   ciphertextOf(row.BodyCiphertext, row.DeletedAt != nil),
		CreatedAt:    row.CreatedAt,
		UpdatedAt:    row.UpdatedAt,
		EditedAt:     row.EditedAt,
		Deleted:      false,
		ReplyCount:   row.ReplyCount,
		LastReplyAt:  asTimePtr(row.LastReplyAt),
		Attachments:  []attachment.View{},
	}
}

func asTimePtr(v any) *time.Time {
	if v == nil {
		return nil
	}
	switch t := v.(type) {
	case time.Time:
		return &t
	case *time.Time:
		return t
	default:
		return nil
	}
}

func fromReply(row store.ListThreadRepliesRow) View {
	return View{
		ID:           row.ID,
		ChannelID:    row.ChannelID,
		ThreadRootID: row.ThreadRootID,
		AuthorID:     row.AuthorID,
		Body:         row.Body,
		Encrypted:    row.Encrypted,
		Ciphertext:   ciphertextOf(row.BodyCiphertext, row.DeletedAt != nil),
		CreatedAt:    row.CreatedAt,
		UpdatedAt:    row.UpdatedAt,
		EditedAt:     row.EditedAt,
		Deleted:      false,
		ReplyCount:   row.ReplyCount,
		LastReplyAt:  row.LastReplyAt,
		Attachments:  []attachment.View{},
	}
}

func beforeToLatest(rows []store.ListTimelineBeforeRow) []store.ListTimelineLatestRow {
	out := make([]store.ListTimelineLatestRow, 0, len(rows))
	for _, row := range rows {
		out = append(out, store.ListTimelineLatestRow{
			ID:             row.ID,
			ChannelID:      row.ChannelID,
			ThreadRootID:   row.ThreadRootID,
			AuthorID:       row.AuthorID,
			Body:           row.Body,
			CreatedAt:      row.CreatedAt,
			UpdatedAt:      row.UpdatedAt,
			EditedAt:       row.EditedAt,
			DeletedAt:      row.DeletedAt,
			Encrypted:      row.Encrypted,
			BodyCiphertext: row.BodyCiphertext,
			ReplyCount:     row.ReplyCount,
			LastReplyAt:    row.LastReplyAt,
		})
	}
	return out
}

func aroundToLatest(rows []store.ListTimelineAroundRow) []store.ListTimelineLatestRow {
	out := make([]store.ListTimelineLatestRow, 0, len(rows))
	for _, row := range rows {
		out = append(out, store.ListTimelineLatestRow{
			ID: row.ID, ChannelID: row.ChannelID, ThreadRootID: row.ThreadRootID,
			AuthorID: row.AuthorID, Body: row.Body, CreatedAt: row.CreatedAt,
			UpdatedAt: row.UpdatedAt, EditedAt: row.EditedAt, DeletedAt: row.DeletedAt,
			Encrypted: row.Encrypted, BodyCiphertext: row.BodyCiphertext,
			ReplyCount: row.ReplyCount, LastReplyAt: row.LastReplyAt,
		})
	}
	return out
}
