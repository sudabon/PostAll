package migrate

import (
	"database/sql"
	"fmt"
	"log"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/stdlib"
	"github.com/sudabon/PostAll/backend/migrations"

	"github.com/pressly/goose/v3"
)

func Up(databaseURL string) error {
	db, err := open(databaseURL)
	if err != nil {
		return err
	}
	defer db.Close()

	goose.SetBaseFS(migrations.Files)
	if err := goose.SetDialect("postgres"); err != nil {
		return err
	}
	if err := goose.Up(db, "."); err != nil {
		return err
	}
	warnIfRealtimePolicyMissing(db)
	return nil
}

func Pending(databaseURL string) ([]string, error) {
	db, err := open(databaseURL)
	if err != nil {
		return nil, err
	}
	defer db.Close()

	goose.SetBaseFS(migrations.Files)
	if err := goose.SetDialect("postgres"); err != nil {
		return nil, err
	}
	all, err := goose.CollectMigrations(".", 0, goose.MaxVersion)
	if err != nil {
		return nil, err
	}
	rows, err := db.Query(`
		select version_id, is_applied
		from goose_db_version
		order by id desc
	`)
	if err != nil {
		return nil, fmt.Errorf("read migration state: %w", err)
	}
	defer rows.Close()

	applied := make(map[int64]bool)
	for rows.Next() {
		var version int64
		var isApplied bool
		if err := rows.Scan(&version, &isApplied); err != nil {
			return nil, fmt.Errorf("read migration state: %w", err)
		}
		if _, seen := applied[version]; !seen {
			applied[version] = isApplied
		}
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("read migration state: %w", err)
	}

	var pending []string
	for _, m := range all {
		if !applied[m.Version] {
			pending = append(pending, m.Source)
		}
	}
	return pending, nil
}

func buildConfig(databaseURL string) (*pgx.ConnConfig, error) {
	if databaseURL == "" {
		return nil, fmt.Errorf("DATABASE_URL is required to apply migrations")
	}
	cfg, err := pgx.ParseConfig(databaseURL)
	if err != nil {
		return nil, err
	}
	// Named prepared statements survive on the server connection. Supavisor
	// reuses that connection for the next client, which yields 42P05.
	cfg.DefaultQueryExecMode = pgx.QueryExecModeDescribeExec
	return cfg, nil
}

func open(databaseURL string) (*sql.DB, error) {
	cfg, err := buildConfig(databaseURL)
	if err != nil {
		return nil, err
	}
	db := stdlib.OpenDB(*cfg)
	db.SetMaxOpenConns(1)
	return db, nil
}

func warnIfRealtimePolicyMissing(db *sql.DB) {
	var messagesExists bool
	if err := db.QueryRow(`select to_regclass('realtime.messages') is not null`).Scan(&messagesExists); err != nil {
		log.Printf("migrate: could not check realtime.messages: %v", err)
		return
	}
	if !messagesExists {
		return
	}
	var policyExists bool
	if err := db.QueryRow(`select exists(select 1 from pg_policies where schemaname='realtime' and tablename='messages' and policyname='postall_events_select')`).Scan(&policyExists); err != nil {
		log.Printf("migrate: could not check realtime policy: %v", err)
		return
	}
	if !policyExists {
		log.Printf("warning: realtime.messages exists but policy postall_events_select is missing; apply it from the SQL Editor")
	}
}
