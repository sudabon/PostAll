package blob

import (
	"context"
	"errors"
	"io"
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

func TestMemoryGet(t *testing.T) {
	m := NewMemory()
	ctx := context.Background()

	if _, _, _, err := m.Get(ctx, "missing"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("get missing: %v", err)
	}

	m.PutObject("k", []byte("data"))
	body, contentType, size, err := m.Get(ctx, "k")
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = body.Close() }()
	if contentType != "" {
		t.Fatalf("content type = %q", contentType)
	}
	if size != 4 {
		t.Fatalf("size = %d", size)
	}
	read, err := io.ReadAll(body)
	if err != nil || string(read) != "data" {
		t.Fatalf("body = %q %v", read, err)
	}
}
