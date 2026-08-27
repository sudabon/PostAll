package main

import (
	"context"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/sudabon/PostAll/backend/internal/migrate"
	"github.com/sudabon/PostAll/backend/internal/testutil"
)

func TestRequireCurrentMigrationsIsReadOnlyAndDetectsGaps(t *testing.T) {
	databaseURL := testutil.PostgresURL(t)
	if err := requireCurrentMigrations(databaseURL); err != nil {
		t.Fatalf("current schema: %v", err)
	}

	pool, err := pgxpool.New(context.Background(), databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)

	var skippedVersion int64
	if err := pool.QueryRow(context.Background(), `
		delete from goose_db_version
		where version_id = (
			select version_id
			from goose_db_version
			where is_applied and version_id > 0
			order by version_id desc
			offset 1 limit 1
		)
		returning version_id
	`).Scan(&skippedVersion); err != nil {
		t.Fatal(err)
	}
	if err := requireCurrentMigrations(databaseURL); err == nil {
		t.Fatal("migration gap check unexpectedly succeeded")
	}
	if _, err := pool.Exec(context.Background(), `
		insert into goose_db_version (version_id, is_applied)
		values ($1, true)
	`, skippedVersion); err != nil {
		t.Fatal(err)
	}

	if _, err := pool.Exec(context.Background(), `
		delete from goose_db_version
		where version_id = (select max(version_id) from goose_db_version)
	`); err != nil {
		t.Fatal(err)
	}

	checkErr := requireCurrentMigrations(databaseURL)
	if checkErr == nil {
		t.Fatal("pending check unexpectedly succeeded")
	}
	pending, err := migrate.Pending(databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	if len(pending) != 1 || !strings.Contains(checkErr.Error(), pending[0]) {
		t.Fatalf("pending after read-only check=%v", pending)
	}

	if _, err := pool.Exec(context.Background(), `drop table goose_db_version`); err != nil {
		t.Fatal(err)
	}
	if err := requireCurrentMigrations(databaseURL); err == nil {
		t.Fatal("missing migration table check unexpectedly succeeded")
	}
	var versionTableExists bool
	if err := pool.QueryRow(context.Background(), `
		select to_regclass('goose_db_version') is not null
	`).Scan(&versionTableExists); err != nil {
		t.Fatal(err)
	}
	if versionTableExists {
		t.Fatal("read-only migration check created goose_db_version")
	}
}
