package attachment

import (
	"testing"

	"github.com/google/uuid"
)

func TestStorageKeyExcludesFileName(t *testing.T) {
	uploader := uuid.MustParse("2015cc28-1db3-4297-bced-ec705f3c5821")
	id := uuid.MustParse("349d6a16-db59-4503-bc08-7fe6eba171a4")
	prefix := "attachments/" + uploader.String() + "/" + id.String() + "/file"
	cases := map[string]string{
		"設計書.md":         prefix + ".md",
		"Photo.JPG":      prefix + ".jpg",
		"README":         prefix,
		"archive.tar.gz": prefix + ".gz",
		"メモ.テキスト":        prefix,
		"a.b c":          prefix,
	}
	for name, want := range cases {
		if got := storageKey(uploader, id, name); got != want {
			t.Errorf("storageKey(%q) = %q, want %q", name, got, want)
		}
	}
}
