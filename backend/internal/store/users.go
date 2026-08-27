package store

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Store struct {
	*Queries
	Pool *pgxpool.Pool
}

func NewStore(pool *pgxpool.Pool) *Store {
	return &Store{Queries: New(pool), Pool: pool}
}

func (s *Store) ResolveByAuthSubject(ctx context.Context, sub string) (string, error) {
	user, err := s.GetUserByAuthSubject(ctx, sub)
	if err == nil {
		return user.ID.String(), nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return "", err
	}
	user, err = s.InsertUserByAuthSubject(ctx, sub)
	if err == nil {
		return user.ID.String(), nil
	}
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "23505" {
		user, err = s.GetUserByAuthSubject(ctx, sub)
		if err != nil {
			return "", err
		}
		return user.ID.String(), nil
	}
	return "", err
}
