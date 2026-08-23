package migrate

import (
	"database/sql"
	"fmt"

	"github.com/sudabon/PostAll/backend/migrations"

	_ "github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"
)

func Up(databaseURL string) error {
	if databaseURL == "" {
		return fmt.Errorf("DATABASE_URL is required to apply migrations")
	}
	db, err := sql.Open("pgx", databaseURL)
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
	if databaseURL == "" {
		return nil, fmt.Errorf("DATABASE_URL is required")
	}
	db, err := sql.Open("pgx", databaseURL)
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
