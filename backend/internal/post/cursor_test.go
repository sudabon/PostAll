package post

import (
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestCursorRoundTrip(t *testing.T) {
	id := uuid.MustParse("11111111-1111-1111-1111-111111111111")
	ts := time.Date(2026, 8, 23, 6, 0, 0, 123456789, time.UTC)
	raw := EncodeCursor(ts, id)
	gotTS, gotID, err := DecodeCursor(raw)
	if err != nil {
		t.Fatal(err)
	}
	if !gotTS.Equal(ts) {
		t.Fatalf("ts=%v want %v", gotTS, ts)
	}
	if gotID != id {
		t.Fatalf("id=%s", gotID)
	}
}

func TestDecodeCursorRejectsGarbage(t *testing.T) {
	if _, _, err := DecodeCursor("not-a-cursor"); err == nil {
		t.Fatal("expected error")
	}
}
