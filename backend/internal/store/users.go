package store

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"
)

type Store struct {
	*Queries
	Pool *pgxpool.Pool
}

func NewStore(pool *pgxpool.Pool) *Store {
	return &Store{Queries: New(pool), Pool: pool}
}

func (s *Store) UpsertByCognitoSub(ctx context.Context, sub string) (string, error) {
	user, err := s.UpsertUserByCognitoSub(ctx, sub)
	if err != nil {
		return "", err
	}
	return user.ID.String(), nil
}
