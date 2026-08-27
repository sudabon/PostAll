package change

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/sudabon/PostAll/backend/internal/store"
)

const defaultLimit = 100
const maxLimit = 200
const eventRetention = 30 * 24 * time.Hour

type Service struct {
	q *store.Queries
}

func NewService(q *store.Queries) *Service {
	return &Service{q: q}
}

type Event struct {
	ID           int64
	EventType    string
	ChannelID    *uuid.UUID
	PostID       *uuid.UUID
	ThreadRootID *uuid.UUID
	CreatedAt    time.Time
}

type Page struct {
	Events        []Event
	NextAfter     int64
	HasMore       bool
	ResetRequired bool
}

func (s *Service) ListAfter(ctx context.Context, after int64, limit int) (Page, error) {
	if limit <= 0 {
		limit = defaultLimit
	}
	if limit > maxLimit {
		limit = maxLimit
	}
	// Read the page before the bounds. If pruning races this recovery, the later
	// bounds read either detects the new gap or the page already contains the
	// events removed after its snapshot.
	rows, err := s.q.ListChangeEventsAfter(ctx, store.ListChangeEventsAfterParams{
		AfterID:  after,
		RowLimit: int32(limit + 1),
	})
	if err != nil {
		return Page{}, err
	}
	bounds, err := s.q.ChangeEventBounds(ctx)
	if err != nil {
		return Page{}, err
	}
	if cursorRequiresReset(after, bounds.LatestID, bounds.PrunedThrough) {
		return Page{
			Events:        []Event{},
			NextAfter:     bounds.LatestID,
			ResetRequired: true,
		}, nil
	}
	events := make([]Event, 0, min(len(rows), limit))
	for _, row := range rows {
		if len(events) == limit {
			break
		}
		events = append(events, Event{
			ID: row.ID, EventType: row.EventType, ChannelID: row.ChannelID,
			PostID: row.PostID, ThreadRootID: row.ThreadRootID, CreatedAt: row.CreatedAt,
		})
	}
	nextAfter := after
	if len(events) > 0 {
		nextAfter = events[len(events)-1].ID
	}
	return Page{Events: events, NextAfter: nextAfter, HasMore: len(rows) > limit}, nil
}

func (s *Service) LatestID(ctx context.Context) (int64, error) {
	return s.q.LatestChangeEventID(ctx)
}

func (s *Service) PruneExpired(ctx context.Context, now time.Time) (int64, error) {
	return s.q.PruneChangeEventsBefore(ctx, now.UTC().Add(-eventRetention))
}

func cursorRequiresReset(after, latest, prunedThrough int64) bool {
	if after == 0 {
		return false
	}
	if after > latest {
		return true
	}
	return after < prunedThrough
}
