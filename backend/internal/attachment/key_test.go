package attachment

import (
	"testing"

	"github.com/google/uuid"
)

func TestStorageKeyIsASCIIEvenWhenFileNameIsNot(t *testing.T) {
	uploader := uuid.MustParse("4080b984-d801-4ed7-8682-c8494f268d42")
	id := uuid.MustParse("d2ff887c-582d-41a3-b904-59c4a19a152b")
	key := storageKey(uploader, id, "請求書.xlsx")
	want := "attachments/4080b984-d801-4ed7-8682-c8494f268d42/d2ff887c-582d-41a3-b904-59c4a19a152b.xlsx"
	if key != want {
		t.Fatalf("storageKey = %q, want %q", key, want)
	}
}

func TestAsciiExt(t *testing.T) {
	cases := map[string]string{
		"a.PNG":       ".png",
		"請求書.xlsx":    ".xlsx",
		"noext":       "",
		"weird.x$x":   "",
		"..xlsx":      ".xlsx",
		"file.tar.gz": ".gz",
	}
	for name, want := range cases {
		if got := asciiExt(name); got != want {
			t.Errorf("asciiExt(%q) = %q, want %q", name, got, want)
		}
	}
}
