package search

import (
	"context"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/sudabon/PostAll/backend/internal/store"
)

const defaultLimit = 20
const maxLimit = 50

type Service struct {
	q *store.Queries
}

func NewService(q *store.Queries) *Service {
	return &Service{q: q}
}

type Input struct {
	Query       string
	ChannelID   *uuid.UUID
	CreatedFrom *time.Time
	CreatedTo   *time.Time
	Limit       int
	Cursor      *string
}

type Result struct {
	PostID         uuid.UUID
	TimelinePostID uuid.UUID
	ChannelID      uuid.UUID
	ChannelName    string
	ThreadRootID   *uuid.UUID
	Body           string
	CreatedAt      time.Time
}

type Page struct {
	Results    []Result
	NextCursor *string
}

func (s *Service) Search(ctx context.Context, in Input) (Page, error) {
	in.Query = strings.TrimSpace(in.Query)
	if utf8.RuneCountInString(in.Query) < 2 {
		return Page{}, errValidation("検索語は2文字以上で入力してください")
	}
	if in.CreatedFrom != nil && in.CreatedTo != nil && in.CreatedFrom.After(*in.CreatedTo) {
		return Page{}, errValidation("検索期間の開始日時は終了日時以前にしてください")
	}
	if in.Limit <= 0 {
		in.Limit = defaultLimit
	}
	if in.Limit > maxLimit {
		in.Limit = maxLimit
	}

	fetch := int32(in.Limit + 1)
	results := make([]Result, 0, fetch)
	if in.Cursor == nil || *in.Cursor == "" {
		rows, err := s.q.SearchPostsLatest(ctx, store.SearchPostsLatestParams{
			SearchQuery: ContainsPattern(in.Query),
			ChannelID:   in.ChannelID,
			CreatedFrom: in.CreatedFrom,
			CreatedTo:   in.CreatedTo,
			RowLimit:    fetch,
		})
		if err != nil {
			return Page{}, err
		}
		for _, row := range rows {
			results = append(results, Result{
				PostID: row.PostID, TimelinePostID: row.TimelinePostID,
				ChannelID: row.ChannelID, ChannelName: row.ChannelName,
				ThreadRootID: row.ThreadRootID, Body: row.Body, CreatedAt: row.CreatedAt,
			})
		}
	} else {
		createdAt, id, err := DecodeCursor(*in.Cursor)
		if err != nil {
			return Page{}, errValidation("検索カーソルが不正です")
		}
		rows, err := s.q.SearchPostsBefore(ctx, store.SearchPostsBeforeParams{
			SearchQuery:     ContainsPattern(in.Query),
			ChannelID:       in.ChannelID,
			CreatedFrom:     in.CreatedFrom,
			CreatedTo:       in.CreatedTo,
			BeforeCreatedAt: createdAt,
			BeforeID:        id,
			RowLimit:        fetch,
		})
		if err != nil {
			return Page{}, err
		}
		for _, row := range rows {
			results = append(results, Result{
				PostID: row.PostID, TimelinePostID: row.TimelinePostID,
				ChannelID: row.ChannelID, ChannelName: row.ChannelName,
				ThreadRootID: row.ThreadRootID, Body: row.Body, CreatedAt: row.CreatedAt,
			})
		}
	}

	hasMore := len(results) > in.Limit
	if hasMore {
		results = results[:in.Limit]
	}
	page := Page{Results: results}
	if hasMore && len(results) > 0 {
		cursor := EncodeCursor(results[len(results)-1].CreatedAt, results[len(results)-1].PostID)
		page.NextCursor = &cursor
	}
	return page, nil
}
