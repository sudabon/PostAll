package blob

import (
	"context"
	"net/url"
	"strings"
	"testing"
)

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
