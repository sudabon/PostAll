package emoji_test

import (
	"context"
	"errors"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/sudabon/PostAll/backend/internal/testutil"
)

func TestReactionPrimaryKeyPreventsDuplicateUserEmojiOnPost(t *testing.T) {
	databaseURL := testutil.PostgresURL(t)
	pool, err := pgxpool.New(context.Background(), databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)

	ctx := context.Background()
	var userID, postID, emojiID string
	if err := pool.QueryRow(ctx, `
		insert into users (auth_subject) values ('reaction-user') returning id
	`).Scan(&userID); err != nil {
		t.Fatal(err)
	}
	var channelID string
	if err := pool.QueryRow(ctx, `
		insert into channels (name, sort_key) values ('reactions', 'a') returning id
	`).Scan(&channelID); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx, `
		insert into posts (channel_id, author_id, body) values ($1, $2, 'hello') returning id
	`, channelID, userID).Scan(&postID); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx, `
		insert into emojis (shortcode, storage_key, checksum)
		values ('shipit', 'shipit.png', 'checksum') returning id
	`).Scan(&emojiID); err != nil {
		t.Fatal(err)
	}

	if _, err := pool.Exec(ctx, `
		insert into reactions (post_id, emoji_id, user_id) values ($1, $2, $3)
	`, postID, emojiID, userID); err != nil {
		t.Fatal(err)
	}
	_, err = pool.Exec(ctx, `
		insert into reactions (post_id, emoji_id, user_id) values ($1, $2, $3)
	`, postID, emojiID, userID)
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) || pgErr.Code != "23505" {
		t.Fatalf("duplicate reaction error = %v, want unique violation", err)
	}

	var count int
	if err := pool.QueryRow(ctx, `select count(*) from reactions`).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Fatalf("reaction count = %d, want 1", count)
	}
}
