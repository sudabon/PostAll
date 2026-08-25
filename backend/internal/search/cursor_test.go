package search

import (
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestCursorRoundTrip(t *testing.T) {
	ts := time.Date(2026, 8, 23, 10, 20, 30, 456789, time.FixedZone("JST", 9*60*60))
	id := uuid.New()
	raw := EncodeCursor(ts, id)
	gotTime, gotID, err := DecodeCursor(raw)
	if err != nil {
		t.Fatal(err)
	}
	if !gotTime.Equal(ts) || gotID != id {
		t.Fatalf("decoded=(%s,%s) want=(%s,%s)", gotTime, gotID, ts, id)
	}
}

func TestCursorRejectsMalformedValues(t *testing.T) {
	for _, raw := range []string{"", "missing-separator", "bad_uuid", "2026-01-01T00:00:00Z_bad"} {
		if _, _, err := DecodeCursor(raw); err == nil {
			t.Fatalf("DecodeCursor(%q) succeeded", raw)
		}
	}
}
