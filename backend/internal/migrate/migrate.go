package migrate

import (
	"database/sql"
	"fmt"

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
	return goose.Up(db, ".")
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
	current, err := goose.GetDBVersion(db)
	if err != nil {
		return nil, err
	}
	max, err := goose.CollectMigrations(".", 0, goose.MaxVersion)
	if err != nil {
		return nil, err
	}
	var pending []string
	for _, m := range max {
		if m.Version > current {
			pending = append(pending, m.Source)
		}
	}
	return pending, nil
}

func open(databaseURL string) (*sql.DB, error) {
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
	db := stdlib.OpenDB(*cfg)
	db.SetMaxOpenConns(1)
	return db, nil
}
