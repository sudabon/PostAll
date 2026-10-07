package blob

import (
	"context"
	"net/url"
	"strings"
	"testing"
)

func TestNewS3RejectsImplicitCredentialChain(t *testing.T) {
	_, err := NewS3(context.Background(), S3Config{Bucket: "attachments"})
	if err == nil {
		t.Fatal("NewS3 succeeded without explicit credentials")
	}
}

func TestPresignPutIncludesContentLengthInSignature(t *testing.T) {
	ctx := context.Background()
	store, err := NewS3(ctx, S3Config{
		Endpoint:  "https://example.storage.supabase.co/storage/v1/s3",
		Region:    "ap-northeast-1",
		Bucket:    "attachments",
		AccessKey: "test-access-key",
		SecretKey: "test-secret-key",
	})
	if err != nil {
		t.Fatal(err)
	}
	rawURL, headers, err := store.PresignPut(ctx, "posts/a.png", "image/png", 12)
	if err != nil {
		t.Fatal(err)
	}
	if headers["Content-Length"] != "12" {
		t.Fatalf("headers=%v", headers)
	}
	parsed, err := url.Parse(rawURL)
	if err != nil {
		t.Fatal(err)
	}
	signed := strings.ToLower(parsed.Query().Get("X-Amz-SignedHeaders"))
	if !strings.Contains(signed, "content-length") {
		t.Fatalf("X-Amz-SignedHeaders=%q does not include content-length", signed)
	}
}

// 署名付き GET は <img> や fetch がそのまま辿る。クライアントが送らないヘッダを
// 署名対象に含めると、ストレージ側の計算と食い違って SignatureDoesNotMatch になる。
// SDK は既定で応答チェックサム検証のために x-amz-checksum-mode を署名に載せるので、
// ここで載っていないことを固定する。
func TestPresignGetSignsOnlyHost(t *testing.T) {
	ctx := context.Background()
	store, err := NewS3(ctx, S3Config{
		Endpoint:  "https://example.storage.supabase.co/storage/v1/s3",
		Region:    "ap-northeast-1",
		Bucket:    "attachments",
		AccessKey: "test-access-key",
		SecretKey: "test-secret-key",
	})
	if err != nil {
		t.Fatal(err)
	}
	rawURL, err := store.PresignGet(ctx, "attachments/uid/aid/a.png", "a.png")
	if err != nil {
		t.Fatal(err)
	}
	parsed, err := url.Parse(rawURL)
	if err != nil {
		t.Fatal(err)
	}
	if signed := parsed.Query().Get("X-Amz-SignedHeaders"); signed != "host" {
		t.Fatalf("X-Amz-SignedHeaders=%q, want %q", signed, "host")
	}
}

func TestContentDispositionEncodesNonASCIIName(t *testing.T) {
	got := contentDisposition(`設計書 (v2).md`)
	want := `attachment; filename="___ (v2).md"; filename*=UTF-8''%E8%A8%AD%E8%A8%88%E6%9B%B8%20%28v2%29.md`
	if got != want {
		t.Fatalf("contentDisposition = %q, want %q", got, want)
	}
}
