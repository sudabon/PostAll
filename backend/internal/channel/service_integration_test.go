package channel_test

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/sudabon/PostAll/backend/internal/channel"
	"github.com/sudabon/PostAll/backend/internal/store"
	"github.com/sudabon/PostAll/backend/internal/testutil"
)

func TestCreateEncryptedChannelRequiresKeyring(t *testing.T) {
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, testutil.PostgresURL(t))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	svc := channel.NewService(store.New(pool))

	_, err = svc.Create(ctx, "secret", nil, true)
	var ce *channel.Error
	if !errors.As(err, &ce) || ce.Code != "encryption_not_configured" || ce.Status != 409 {
		t.Fatalf("err=%v, want 409 encryption_not_configured", err)
	}
	list, err := svc.List(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 0 {
		t.Fatalf("channel created without keyring: %+v", list)
	}

	if _, err := pool.Exec(ctx, `
		insert into encryption_keyring (key_id, auth_hash, passphrase_wrap, recovery_wrap)
		values ($1, '\x00', '{}', '{}')
	`, uuid.New()); err != nil {
		t.Fatal(err)
	}
	secret, err := svc.Create(ctx, "secret", nil, true)
	if err != nil {
		t.Fatal(err)
	}
	if !secret.Encrypted {
		t.Fatal("encrypted channel created as plain")
	}
	child, err := svc.Create(ctx, "child", &secret.ID, false)
	if err != nil {
		t.Fatal(err)
	}
	if child.Encrypted {
		t.Fatal("child inherited encryption from its parent")
	}
	plain, err := svc.Create(ctx, "inbox", nil, false)
	if err != nil {
		t.Fatal(err)
	}
	if plain.Encrypted {
		t.Fatal("plain channel created as encrypted")
	}

	renamed, err := svc.Rename(ctx, secret.ID, "renamed")
	if err != nil {
		t.Fatal(err)
	}
	moved, err := svc.Move(ctx, secret.ID, channel.MoveInput{ParentID: &plain.ID})
	if err != nil {
		t.Fatal(err)
	}
	if !renamed.Encrypted || !moved.Encrypted {
		t.Fatalf("rename/move changed encryption: renamed=%v moved=%v", renamed.Encrypted, moved.Encrypted)
	}
	list, err = svc.List(ctx)
	if err != nil {
		t.Fatal(err)
	}
	for _, ch := range list {
		if want := ch.ID == secret.ID; ch.Encrypted != want {
			t.Fatalf("list %s encrypted=%v want %v", ch.Name, ch.Encrypted, want)
		}
	}
}
