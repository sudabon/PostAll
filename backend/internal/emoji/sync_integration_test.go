package emoji_test

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	emojisync "github.com/sudabon/PostAll/backend/internal/emoji"
	"github.com/sudabon/PostAll/backend/internal/store"
	"github.com/sudabon/PostAll/backend/internal/testutil"
)

func TestSyncRegistersUpdatesAndSkipsInvalidFiles(t *testing.T) {
	databaseURL := testutil.PostgresURL(t)
	pool, err := pgxpool.New(context.Background(), databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)

	dir := t.TempDir()
	writeFixture(t, dir, "shipit.png", "v1")
	writeFixture(t, dir, "SmartHR.png", "logo")
	writeFixture(t, dir, "bad name.png", "bad")
	writeFixture(t, dir, "animated.gif", "gif")

	service := emojisync.NewService(store.New(pool))
	first, err := service.Sync(context.Background(), dir)
	if err != nil {
		t.Fatal(err)
	}
	if first.Created != 2 || first.Updated != 0 || first.Unchanged != 0 || first.Skipped != 2 {
		t.Fatalf("first sync = %+v", first)
	}
	if len(first.Issues) != 2 || first.Issues[0].File != "animated.gif" || first.Issues[1].File != "bad name.png" {
		t.Fatalf("issues = %+v", first.Issues)
	}

	var originalID, checksum, storageKey string
	if err := pool.QueryRow(context.Background(), `
		select id, checksum, storage_key from emojis where shortcode = 'shipit'
	`).Scan(&originalID, &checksum, &storageKey); err != nil {
		t.Fatal(err)
	}
	if checksum != "3bfc269594ef649228e9a74bab00f042efc91d5acc6fbee31a382e80d42388fe" {
		t.Fatalf("checksum = %q", checksum)
	}
	if storageKey != "shipit.png" {
		t.Fatalf("storage key = %q", storageKey)
	}

	writeFixture(t, dir, "shipit.png", "v2")
	second, err := service.Sync(context.Background(), dir)
	if err != nil {
		t.Fatal(err)
	}
	if second.Created != 0 || second.Updated != 1 || second.Unchanged != 1 || second.Skipped != 2 {
		t.Fatalf("second sync = %+v", second)
	}
	var updatedID, updatedChecksum string
	if err := pool.QueryRow(context.Background(), `
		select id, checksum from emojis where shortcode = 'shipit'
	`).Scan(&updatedID, &updatedChecksum); err != nil {
		t.Fatal(err)
	}
	if updatedID != originalID {
		t.Fatalf("emoji id changed from %s to %s", originalID, updatedID)
	}
	if updatedChecksum != "fb04dcb6970e4c3d1873de51fd5a50d7bb46b3383113602665c350ec40b5f990" {
		t.Fatalf("updated checksum = %q", updatedChecksum)
	}

	third, err := service.Sync(context.Background(), dir)
	if err != nil {
		t.Fatal(err)
	}
	if third.Created != 0 || third.Updated != 0 || third.Unchanged != 2 || third.Skipped != 2 {
		t.Fatalf("third sync = %+v", third)
	}
}

func writeFixture(t *testing.T, dir, name, contents string) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(dir, name), []byte(contents), 0o600); err != nil {
		t.Fatal(err)
	}
}
