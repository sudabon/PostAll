package httpapi

import (
	"testing"

	"github.com/jackc/pgx/v5"
)

func TestPoolConfigUsesDescribeExecAndLimitsConns(t *testing.T) {
	cfg, err := newPoolConfig("postgres://postall:postall@127.0.0.1:5432/postall?sslmode=disable")
	if err != nil {
		t.Fatal(err)
	}
	if cfg.ConnConfig.DefaultQueryExecMode != pgx.QueryExecModeDescribeExec {
		t.Fatalf("DefaultQueryExecMode = %v, want DescribeExec", cfg.ConnConfig.DefaultQueryExecMode)
	}
	if cfg.MaxConns != 2 {
		t.Fatalf("MaxConns = %d, want 2", cfg.MaxConns)
	}
}
