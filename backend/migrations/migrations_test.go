package migrations_test

import (
	"context"
	"database/sql"
	"regexp"
	"strings"
	"testing"

	_ "github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"
	"github.com/sudabon/PostAll/backend/internal/testutil"
	"github.com/sudabon/PostAll/backend/migrations"
)

func TestRealtimePolicyIsTopicAndExtensionScoped(t *testing.T) {
	contents := migration(t, "00011_realtime_rls.sql")
	for _, required := range []string{
		"realtime.topic() = 'postall:events'",
		"extension = 'broadcast'",
	} {
		if !strings.Contains(contents, required) {
			t.Errorf("migration is missing %q", required)
		}
	}
	if regexp.MustCompile(`using\s*\(\s*true\s*\)`).MatchString(strings.ToLower(contents)) {
		t.Fatal("migration still grants unscoped realtime.messages SELECT")
	}
}

func TestBestEffortNotificationIsObservable(t *testing.T) {
	contents := strings.ToLower(migration(t, "00012_realtime_notify_best_effort.sql"))
	if !strings.Contains(contents, "raise warning") {
		t.Fatal("notification errors are still silent")
	}
	if !strings.Contains(contents, "sqlstate") || !strings.Contains(contents, "sqlerrm") {
		t.Fatal("warning does not record SQLSTATE and the database error")
	}
}

func TestPGroongaDownDropsIndexAndExtension(t *testing.T) {
	contents := strings.ToLower(migration(t, "00008_pgroonga.sql"))
	down := contents[strings.Index(contents, "-- +goose down"):]
	if strings.Contains(down, "pg_bigm") || strings.Contains(down, "posts_body_bigm") {
		t.Fatal("down still requires pg_bigm")
	}
	assertOrdered(t, contents,
		"-- +goose down",
		"drop index if exists posts_body_pgroonga",
		"drop extension if exists pgroonga",
	)
}

func TestChangeEventRetentionStateIsLockedDown(t *testing.T) {
	contents := strings.ToLower(migration(t, "00015_change_event_retention.sql"))
	for _, required := range []string{
		"alter table change_event_retention enable row level security",
		"revoke all on table change_event_retention",
	} {
		if !strings.Contains(contents, required) {
			t.Errorf("retention migration is missing %q", required)
		}
	}
}

func TestEraseDeletedPostBodiesKeepsDeletionAndThreads(t *testing.T) {
	db := openUnmigrated(t)
	ctx := context.Background()
	migrateTo(t, db, 15)

	var userID, channelID, rootID, replyID, liveReplyID, liveID string
	mustScan(t, db.QueryRowContext(ctx, `insert into users (auth_subject) values ('migration-user') returning id`), &userID)
	mustScan(t, db.QueryRowContext(ctx, `insert into channels (name, sort_key) values ('inbox', 'a') returning id`), &channelID)
	mustScan(t, db.QueryRowContext(ctx, `
		insert into posts (channel_id, author_id, body, deleted_at)
		values ($1, $2, 'secret root', now() - interval '1 day') returning id
	`, channelID, userID), &rootID)
	mustScan(t, db.QueryRowContext(ctx, `
		insert into posts (channel_id, thread_root_id, author_id, body, deleted_at)
		values ($1, $2, $3, 'secret reply', now() - interval '1 hour') returning id
	`, channelID, rootID, userID), &replyID)
	mustScan(t, db.QueryRowContext(ctx, `
		insert into posts (channel_id, thread_root_id, author_id, body)
		values ($1, $2, $3, 'live reply') returning id
	`, channelID, rootID, userID), &liveReplyID)
	mustScan(t, db.QueryRowContext(ctx, `
		insert into posts (channel_id, author_id, body) values ($1, $2, 'live root') returning id
	`, channelID, userID), &liveID)

	deletedAt := func(id string) string {
		t.Helper()
		var v sql.NullString
		mustScan(t, db.QueryRowContext(ctx, `select deleted_at::text from posts where id = $1`, id), &v)
		return v.String
	}
	rootDeletedAt, replyDeletedAt := deletedAt(rootID), deletedAt(replyID)

	migrateTo(t, db, 16)

	type row struct {
		body         string
		deletedAt    sql.NullString
		threadRootID sql.NullString
	}
	read := func(id string) row {
		t.Helper()
		var r row
		mustScan(t, db.QueryRowContext(ctx, `
			select body, deleted_at::text, thread_root_id::text from posts where id = $1
		`, id), &r.body, &r.deletedAt, &r.threadRootID)
		return r
	}
	if r := read(rootID); r.body != "" || r.deletedAt.String != rootDeletedAt || r.threadRootID.Valid {
		t.Fatalf("deleted root = %+v, want empty body and deleted_at %s", r, rootDeletedAt)
	}
	if r := read(replyID); r.body != "" || r.deletedAt.String != replyDeletedAt || r.threadRootID.String != rootID {
		t.Fatalf("deleted reply = %+v, want empty body, deleted_at %s, thread_root_id %s", r, replyDeletedAt, rootID)
	}
	if r := read(liveReplyID); r.body != "live reply" || r.deletedAt.Valid {
		t.Fatalf("live reply changed: %+v", r)
	}
	if r := read(liveID); r.body != "live root" || r.deletedAt.Valid {
		t.Fatalf("live root changed: %+v", r)
	}

	// Down は何もしない（消した本文は戻らない）が、失敗せずに 00015 へ戻れること。
	if err := goose.DownTo(db, ".", 15); err != nil {
		t.Fatalf("down to 15: %v", err)
	}
	if r := read(rootID); r.body != "" {
		t.Fatalf("down restored body %q", r.body)
	}
}

func TestEraseDeletedPostBodiesDownIsDocumentedNoop(t *testing.T) {
	contents := strings.ToLower(migration(t, "00016_erase_deleted_post_bodies.sql"))
	down := contents[strings.Index(contents, "-- +goose down"):]
	if strings.Contains(down, "update") || strings.Contains(down, "insert") {
		t.Fatal("down must not try to restore erased bodies")
	}
	if !strings.Contains(down, "戻す") {
		t.Fatal("down does not explain why it cannot be reverted")
	}
}

const testCiphertext = "pe1.00000000-0000-4000-8000-000000000001.AAAAAAAAAAAAAAAA.c2VjcmV0"

func TestChannelEncryptionKeepsPostsConsistentWithChannel(t *testing.T) {
	db := openUnmigrated(t)
	ctx := context.Background()
	migrateTo(t, db, 17)

	var userID, plainID, encryptedID string
	mustScan(t, db.QueryRowContext(ctx, `insert into users (auth_subject) values ('migration-user') returning id`), &userID)
	mustScan(t, db.QueryRowContext(ctx, `insert into channels (name, sort_key) values ('inbox', 'a') returning id`), &plainID)
	mustScan(t, db.QueryRowContext(ctx, `
		insert into channels (name, sort_key, encrypted) values ('secret', 'b', true) returning id
	`), &encryptedID)

	var rootID string
	mustScan(t, db.QueryRowContext(ctx, `
		insert into posts (channel_id, author_id, encrypted, body_ciphertext)
		values ($1, $2, true, $3) returning id
	`, encryptedID, userID, testCiphertext), &rootID)
	if _, err := db.ExecContext(ctx, `
		insert into posts (channel_id, thread_root_id, author_id, encrypted, body_ciphertext)
		values ($1, $2, $3, true, $4)
	`, encryptedID, rootID, userID, testCiphertext); err != nil {
		t.Fatalf("encrypted reply: %v", err)
	}
	if _, err := db.ExecContext(ctx, `insert into posts (channel_id, author_id, body) values ($1, $2, 'plain')`, plainID, userID); err != nil {
		t.Fatalf("plain post: %v", err)
	}

	rejected := []struct {
		name string
		sql  string
		args []any
	}{
		{"plain post in encrypted channel", `insert into posts (channel_id, author_id, body) values ($1, $2, 'leak')`, []any{encryptedID, userID}},
		{"encrypted post with plain body", `
			insert into posts (channel_id, author_id, encrypted, body, body_ciphertext)
			values ($1, $2, true, 'leak', $3)`, []any{encryptedID, userID, testCiphertext}},
		{"live encrypted post without ciphertext", `
			insert into posts (channel_id, author_id, encrypted) values ($1, $2, true)`, []any{encryptedID, userID}},
		{"ciphertext in plain channel", `
			insert into posts (channel_id, author_id, body_ciphertext) values ($1, $2, $3)`, []any{plainID, userID, testCiphertext}},
		{"encrypted flag in plain channel", `
			insert into posts (channel_id, author_id, encrypted, body_ciphertext)
			values ($1, $2, true, $3)`, []any{plainID, userID, testCiphertext}},
		{"plain body written over an encrypted post", `update posts set body = 'leak' where id = $1`, []any{rootID}},
		{"post moved to the other kind of channel", `update posts set channel_id = $1 where id = $2`, []any{plainID, rootID}},
	}
	for _, tc := range rejected {
		if _, err := db.ExecContext(ctx, tc.sql, tc.args...); err == nil {
			t.Errorf("%s: accepted, want constraint violation", tc.name)
		}
	}

	// 論理削除では暗号文を消せる。削除済みであることとスレッドの参照は残る。
	if _, err := db.ExecContext(ctx, `
		update posts set deleted_at = now(), body_ciphertext = null where id = $1
	`, rootID); err != nil {
		t.Fatalf("soft delete encrypted post: %v", err)
	}

	for _, tc := range []struct{ id, value string }{{encryptedID, "false"}, {plainID, "true"}} {
		if _, err := db.ExecContext(ctx, `update channels set encrypted = `+tc.value+` where id = $1`, tc.id); err == nil {
			t.Errorf("channels.encrypted of %s changed to %s", tc.id, tc.value)
		}
	}
	if _, err := db.ExecContext(ctx, `update channels set name = 'renamed', parent_id = $1 where id = $2`, plainID, encryptedID); err != nil {
		t.Fatalf("rename and move encrypted channel: %v", err)
	}
	var stillEncrypted bool
	mustScan(t, db.QueryRowContext(ctx, `select encrypted from channels where id = $1`, encryptedID), &stillEncrypted)
	if !stillEncrypted {
		t.Fatal("rename/move changed channels.encrypted")
	}
}

func TestEncryptionKeyringHoldsASingleRow(t *testing.T) {
	db := openUnmigrated(t)
	ctx := context.Background()
	migrateTo(t, db, 17)

	insert := func(keyID string) error {
		_, err := db.ExecContext(ctx, `
			insert into encryption_keyring (key_id, auth_hash, passphrase_wrap, recovery_wrap)
			values ($1, '\x00', '{}', '{}')
		`, keyID)
		return err
	}
	if err := insert("00000000-0000-4000-8000-000000000001"); err != nil {
		t.Fatalf("first keyring: %v", err)
	}
	if err := insert("00000000-0000-4000-8000-000000000002"); err == nil {
		t.Fatal("second keyring row was accepted")
	}
	if _, err := db.ExecContext(ctx, `
		insert into encryption_keyring (key_id, singleton, auth_hash, passphrase_wrap, recovery_wrap)
		values ('00000000-0000-4000-8000-000000000003', false, '\x00', '{}', '{}')
	`); err == nil {
		t.Fatal("non-singleton keyring row was accepted")
	}
}

func TestChannelEncryptionDownRefusesWhileEncryptedChannelsExist(t *testing.T) {
	db := openUnmigrated(t)
	ctx := context.Background()
	migrateTo(t, db, 17)

	var channelID string
	mustScan(t, db.QueryRowContext(ctx, `
		insert into channels (name, sort_key, encrypted) values ('secret', 'a', true) returning id
	`), &channelID)
	if err := goose.DownTo(db, ".", 16); err == nil {
		t.Fatal("down succeeded while an encrypted channel exists")
	}
	var version int64
	mustScan(t, db.QueryRowContext(ctx, `select max(version_id) from goose_db_version where is_applied`), &version)
	if version != 17 {
		t.Fatalf("version after failed down = %d, want 17", version)
	}

	if _, err := db.ExecContext(ctx, `delete from channels where id = $1`, channelID); err != nil {
		t.Fatal(err)
	}
	if err := goose.DownTo(db, ".", 16); err != nil {
		t.Fatalf("down without encrypted channels: %v", err)
	}
	var columns int
	mustScan(t, db.QueryRowContext(ctx, `
		select count(*) from information_schema.columns
		where table_name in ('channels', 'posts') and column_name in ('encrypted', 'body_ciphertext')
	`), &columns)
	if columns != 0 {
		t.Fatalf("%d encryption columns remain after down", columns)
	}
}

func TestEncryptionKeyringIsLockedDown(t *testing.T) {
	contents := strings.ToLower(migration(t, "00017_channel_encryption.sql"))
	for _, required := range []string{
		"alter table encryption_keyring enable row level security",
		"revoke all on table encryption_keyring",
	} {
		if !strings.Contains(contents, required) {
			t.Errorf("keyring migration is missing %q", required)
		}
	}
}

func openUnmigrated(t *testing.T) *sql.DB {
	t.Helper()
	db, err := sql.Open("pgx", testutil.EmptyPostgresURL(t))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	goose.SetBaseFS(migrations.Files)
	if err := goose.SetDialect("postgres"); err != nil {
		t.Fatal(err)
	}
	return db
}

func migrateTo(t *testing.T, db *sql.DB, version int64) {
	t.Helper()
	if err := goose.UpTo(db, ".", version); err != nil {
		t.Fatalf("migrate to %d: %v", version, err)
	}
}

func mustScan(t *testing.T, row *sql.Row, dest ...any) {
	t.Helper()
	if err := row.Scan(dest...); err != nil {
		t.Fatal(err)
	}
}

func migration(t *testing.T, name string) string {
	t.Helper()
	contents, err := migrations.Files.ReadFile(name)
	if err != nil {
		t.Fatal(err)
	}
	return string(contents)
}

func assertOrdered(t *testing.T, contents string, values ...string) {
	t.Helper()
	position := 0
	for _, value := range values {
		next := strings.Index(contents[position:], value)
		if next < 0 {
			t.Fatalf("%q is missing or out of order", value)
		}
		position += next + len(value)
	}
}
