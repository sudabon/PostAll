package change

import "testing"

func TestCursorRequiresReset(t *testing.T) {
	tests := []struct {
		name                         string
		after, latest, prunedThrough int64
		want                         bool
	}{
		{name: "legacy zero cursor", after: 0, latest: 20, prunedThrough: 10, want: false},
		{name: "inside retained range", after: 12, latest: 20, prunedThrough: 10, want: false},
		{name: "at pruned watermark", after: 10, latest: 20, prunedThrough: 10, want: false},
		{name: "retention gap", after: 9, latest: 20, prunedThrough: 10, want: true},
		{name: "identity gap without pruning", after: 8, latest: 20, prunedThrough: 0, want: false},
		{name: "database restored behind cursor", after: 21, latest: 20, prunedThrough: 10, want: true},
		{name: "empty database with old cursor", after: 1, latest: 0, prunedThrough: 0, want: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := cursorRequiresReset(tt.after, tt.latest, tt.prunedThrough); got != tt.want {
				t.Fatalf("cursorRequiresReset(%d, %d, %d)=%v want %v", tt.after, tt.latest, tt.prunedThrough, got, tt.want)
			}
		})
	}
}
