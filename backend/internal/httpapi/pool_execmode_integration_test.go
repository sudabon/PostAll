package httpapi

import (
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

func TestPoolConfigUsesExecAndLimitsConns(t *testing.T) {
	cfg, err := newPoolConfig("postgres://postall:postall@127.0.0.1:5432/postall?sslmode=disable")
	if err != nil {
		t.Fatal(err)
	}
	if cfg.ConnConfig.DefaultQueryExecMode != pgx.QueryExecModeExec {
		t.Fatalf("DefaultQueryExecMode = %v, want Exec", cfg.ConnConfig.DefaultQueryExecMode)
	}
	if cfg.MaxConns != 2 {
		t.Fatalf("MaxConns = %d, want 2", cfg.MaxConns)
	}
	if cfg.AfterConnect == nil {
		t.Fatal("AfterConnect is nil, want uuid[] type registration")
	}
}

func TestRegisterQueryExecTypesEncodesUUIDArray(t *testing.T) {
	id := uuid.MustParse("11111111-1111-1111-1111-111111111111")
	m := pgtype.NewMap()
	registerQueryExecTypes(m)

	buf, err := m.Encode(0, pgtype.TextFormatCode, []uuid.UUID{id}, nil)
	if err != nil {
		t.Fatalf("encode []uuid.UUID: %v", err)
	}
	if got := string(buf); got != "{11111111-1111-1111-1111-111111111111}" {
		t.Fatalf("encoded = %q, want uuid[] text", got)
	}
}
