package blob

import "context"

type Store interface {
	PresignPut(ctx context.Context, key, contentType string, size int64) (url string, headers map[string]string, err error)
	PresignGet(ctx context.Context, key, filename string) (url string, err error)
	Head(ctx context.Context, key string) (exists bool, size int64, err error)
	Delete(ctx context.Context, key string) error
}
