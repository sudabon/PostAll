package main

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/sudabon/PostAll/backend/internal/testutil"
)

func TestEmojiSyncCommandRunsWithoutStartingHTTPServer(t *testing.T) {
	databaseURL := testutil.PostgresURL(t)
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "ok.png"), []byte("png"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "skip.gif"), []byte("gif"), 0o600); err != nil {
		t.Fatal(err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "go", "run", ".", "emoji-sync")
	cmd.Env = append(os.Environ(),
		"DATABASE_URL="+databaseURL,
		"EMOJI_DIR="+dir,
		"LISTEN_ADDR=bad-address",
	)
	output, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("emoji-sync: %v\n%s", err, output)
	}
	if !strings.Contains(string(output), "created=1") || !strings.Contains(string(output), "skip.gif") {
		t.Fatalf("output = %s", output)
	}

	pool, err := pgxpool.New(context.Background(), databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	var count int
	if err := pool.QueryRow(context.Background(), `select count(*) from emojis where shortcode = 'ok'`).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Fatalf("emoji count = %d, want 1", count)
	}
}
