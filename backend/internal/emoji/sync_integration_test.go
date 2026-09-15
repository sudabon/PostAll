package emoji_test

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/sudabon/PostAll/backend/internal/blob"
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

	objects := blob.NewMemory()
	service := emojisync.NewService(store.New(pool))
	first, err := service.Sync(context.Background(), dir, objects)
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

	if !objects.Has("shipit.png") || !objects.Has("SmartHR.png") {
		t.Fatal("png files were not uploaded")
	}

	writeFixture(t, dir, "shipit.png", "v2")
	second, err := service.Sync(context.Background(), dir, objects)
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

	if !objects.Has("shipit.png") {
		t.Fatal("updated png was not uploaded")
	}
	if err := objects.Delete(context.Background(), "shipit.png"); err != nil {
		t.Fatal(err)
	}

	third, err := service.Sync(context.Background(), dir, objects)
	if err != nil {
		t.Fatal(err)
	}
	if third.Created != 0 || third.Updated != 1 || third.Unchanged != 1 || third.Skipped != 2 {
		t.Fatalf("third sync = %+v", third)
	}
	if !objects.Has("shipit.png") {
		t.Fatal("missing unchanged png was not repaired")
	}
}

// 要求経路から登録されたスタンプは、`emoji/` に同じショートコードのファイルが
// 無い限り、一括登録で触られない。
func TestSyncLeavesRequestPathEmojisAlone(t *testing.T) {
	ctx := context.Background()
	pool := testPool(t)
	objects := blob.NewMemory()
	service := emojisync.NewService(store.New(pool))

	uploaded, err := service.Register(ctx, objects, "uploaded", tinyPNG(t))
	if err != nil {
		t.Fatal(err)
	}

	// `emoji/` 側には別のショートコードの png だけを置く。
	dir := t.TempDir()
	writeFixture(t, dir, "from-repo.png", "repo")

	result, err := service.Sync(ctx, dir, objects)
	if err != nil {
		t.Fatal(err)
	}
	if result.Created != 1 || result.Updated != 0 || result.Unchanged != 0 {
		t.Fatalf("sync = %+v, want created=1 のみ", result)
	}

	after, err := service.GetByShortcode(ctx, "uploaded")
	if err != nil {
		t.Fatal(err)
	}
	if after.ID != uploaded.ID || after.StorageKey != uploaded.StorageKey || after.Checksum != uploaded.Checksum {
		t.Fatalf("要求経路の行が変わった: before=%+v after=%+v", uploaded, after)
	}
	if !objects.Has(uploaded.StorageKey) {
		t.Fatalf("要求経路の実体 %q が消えている", uploaded.StorageKey)
	}
	if !objects.Has("from-repo.png") {
		t.Fatal("一括登録の png が置かれていない")
	}

	// リアクションとの結び付きも維持される。
	items, err := service.List(ctx)
	if err != nil {
		t.Fatal(err)
	}
	shortcodes := map[string]bool{}
	for _, item := range items {
		shortcodes[item.Shortcode] = true
	}
	if !shortcodes["uploaded"] || !shortcodes["from-repo"] {
		t.Fatalf("catalog = %+v, want uploaded と from-repo の両方", items)
	}
}

func writeFixture(t *testing.T, dir, name, contents string) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(dir, name), []byte(contents), 0o600); err != nil {
		t.Fatal(err)
	}
}
