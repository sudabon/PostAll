package channel

import (
	"context"
	"errors"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/sudabon/PostAll/backend/internal/sortkey"
	"github.com/sudabon/PostAll/backend/internal/store"
)

type Service struct {
	q *store.Queries
}

func NewService(q *store.Queries) *Service {
	return &Service{q: q}
}

func (s *Service) List(ctx context.Context) ([]store.Channel, error) {
	rows, err := s.q.ListChannelTree(ctx)
	if err != nil {
		return nil, err
	}
	if rows == nil {
		return []store.Channel{}, nil
	}
	return rows, nil
}

func (s *Service) Create(ctx context.Context, name string, parentID *uuid.UUID) (store.Channel, error) {
	name, err := normalizeName(name)
	if err != nil {
		return store.Channel{}, err
	}
	if err := s.requireParent(ctx, parentID); err != nil {
		return store.Channel{}, err
	}
	key, err := s.sortKeyAtEnd(ctx, parentID, uuid.Nil)
	if err != nil {
		return store.Channel{}, err
	}
	row, err := s.q.InsertChannel(ctx, store.InsertChannelParams{
		ParentID: parentID,
		Name:     name,
		SortKey:  key,
	})
	if err != nil {
		return store.Channel{}, mapWriteErr(err)
	}
	return row, nil
}

func (s *Service) Rename(ctx context.Context, id uuid.UUID, name string) (store.Channel, error) {
	name, err := normalizeName(name)
	if err != nil {
		return store.Channel{}, err
	}
	if _, err := s.get(ctx, id); err != nil {
		return store.Channel{}, err
	}
	row, err := s.q.RenameChannel(ctx, store.RenameChannelParams{ID: id, Name: name})
	if err != nil {
		return store.Channel{}, mapWriteErr(err)
	}
	return row, nil
}

type MoveInput struct {
	ParentID *uuid.UUID
	BeforeID *uuid.UUID
	AfterID  *uuid.UUID
}

func (s *Service) Move(ctx context.Context, id uuid.UUID, in MoveInput) (store.Channel, error) {
	if _, err := s.get(ctx, id); err != nil {
		return store.Channel{}, err
	}
	if err := s.requireParent(ctx, in.ParentID); err != nil {
		return store.Channel{}, err
	}
	if in.ParentID != nil && *in.ParentID == id {
		return store.Channel{}, errCycle()
	}
	if in.ParentID != nil {
		cycle, err := s.q.IsAncestorOf(ctx, id, *in.ParentID)
		if err != nil {
			return store.Channel{}, err
		}
		if cycle {
			return store.Channel{}, errCycle()
		}
	}
	key, err := s.sortKeyBetween(ctx, id, in)
	if err != nil {
		return store.Channel{}, err
	}
	row, err := s.q.UpdateChannelLocation(ctx, store.UpdateChannelLocationParams{
		ParentID: in.ParentID,
		SortKey:  key,
		ID:       id,
	})
	if err != nil {
		return store.Channel{}, mapWriteErr(err)
	}
	return row, nil
}

func (s *Service) Delete(ctx context.Context, id uuid.UUID) error {
	if _, err := s.get(ctx, id); err != nil {
		return err
	}
	n, err := s.q.CountLivePostsInTree(ctx, id)
	if err != nil {
		return err
	}
	if n > 0 {
		return errHasPosts(n)
	}
	return s.q.DeleteChannel(ctx, id)
}

func (s *Service) get(ctx context.Context, id uuid.UUID) (store.Channel, error) {
	row, err := s.q.GetChannel(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) {
		return store.Channel{}, errNotFound("チャネルが見つかりません")
	}
	return row, err
}

func (s *Service) requireParent(ctx context.Context, parentID *uuid.UUID) error {
	if parentID == nil {
		return nil
	}
	_, err := s.get(ctx, *parentID)
	return err
}

func (s *Service) sortKeyAtEnd(ctx context.Context, parentID *uuid.UUID, exclude uuid.UUID) (string, error) {
	siblings, err := s.siblingsExcluding(ctx, parentID, exclude)
	if err != nil {
		return "", err
	}
	prev := ""
	if len(siblings) > 0 {
		prev = siblings[len(siblings)-1].SortKey
	}
	return betweenOrDefault(prev, "")
}

func (s *Service) sortKeyBetween(ctx context.Context, moving uuid.UUID, in MoveInput) (string, error) {
	siblings, err := s.siblingsExcluding(ctx, in.ParentID, moving)
	if err != nil {
		return "", err
	}
	byID := make(map[uuid.UUID]store.Channel, len(siblings))
	for _, ch := range siblings {
		byID[ch.ID] = ch
	}
	var after, before *store.Channel
	if in.AfterID != nil {
		ch, ok := byID[*in.AfterID]
		if !ok {
			return "", errValidation("afterId は移動先の兄弟チャネルである必要があります")
		}
		after = &ch
	}
	if in.BeforeID != nil {
		ch, ok := byID[*in.BeforeID]
		if !ok {
			return "", errValidation("beforeId は移動先の兄弟チャネルである必要があります")
		}
		before = &ch
	}
	if after == nil && before == nil {
		return s.sortKeyAtEnd(ctx, in.ParentID, moving)
	}
	prev, next := "", ""
	if after != nil {
		prev = after.SortKey
		if before == nil {
			for i, ch := range siblings {
				if ch.ID == after.ID && i+1 < len(siblings) {
					next = siblings[i+1].SortKey
					break
				}
			}
		}
	}
	if before != nil {
		next = before.SortKey
		if after == nil {
			for i, ch := range siblings {
				if ch.ID == before.ID && i > 0 {
					prev = siblings[i-1].SortKey
					break
				}
			}
		}
	}
	return betweenOrDefault(prev, next)
}

func (s *Service) siblingsExcluding(ctx context.Context, parentID *uuid.UUID, exclude uuid.UUID) ([]store.Channel, error) {
	rows, err := s.q.ListSiblings(ctx, parentID)
	if err != nil {
		return nil, err
	}
	out := make([]store.Channel, 0, len(rows))
	for _, row := range rows {
		if row.ID == exclude {
			continue
		}
		out = append(out, row)
	}
	return out, nil
}

func betweenOrDefault(prev, next string) (string, error) {
	key, err := sortkey.Between(prev, next)
	if err != nil {
		return sortkey.First(), nil
	}
	return key, nil
}

func normalizeName(name string) (string, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return "", errValidation("チャネル名は必須です")
	}
	return name, nil
}

func mapWriteErr(err error) error {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "23505" {
		return errNameConflict()
	}
	return err
}
