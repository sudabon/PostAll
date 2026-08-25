package blob

import (
	"context"
	"testing"
)

func TestMemoryPutHeadDelete(t *testing.T) {
	m := NewMemory()
	ctx := context.Background()
	url, headers, err := m.PresignPut(ctx, "k", "text/plain", 4)
	if err != nil || url == "" || headers["Content-Type"] != "text/plain" {
		t.Fatalf("presign put: %q %v %v", url, headers, err)
	}
	if m.LastKey != "k" {
		t.Fatalf("last key=%q", m.LastKey)
	}
	exists, _, err := m.Head(ctx, "k")
	if err != nil || exists {
		t.Fatalf("head before put: %v %v", exists, err)
	}
	m.PutObject("k", []byte("data"))
	exists, size, err := m.Head(ctx, "k")
	if err != nil || !exists || size != 4 {
		t.Fatalf("head after put: %v %d %v", exists, size, err)
	}
	if err := m.Delete(ctx, "k"); err != nil {
		t.Fatal(err)
	}
	if m.Has("k") {
		t.Fatal("expected deleted")
	}
}
