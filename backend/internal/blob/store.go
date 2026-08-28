package blob

import (
	"context"
	"errors"
	"io"
)

// ErrNotFound はオブジェクトが存在しないことを表す。Get の呼び出し側が
// 404 と 500 を区別できるようにするための番兵エラー。
var ErrNotFound = errors.New("blob: object not found")

type Store interface {
	PresignPut(ctx context.Context, key, contentType string, size int64) (url string, headers map[string]string, err error)
	PresignGet(ctx context.Context, key, filename string) (url string, err error)
	// Get はオブジェクト本体を返す。存在しない場合は ErrNotFound を返す。
	// 呼び出し側は body を必ず Close する。
	Get(ctx context.Context, key string) (body io.ReadCloser, contentType string, size int64, err error)
	Head(ctx context.Context, key string) (exists bool, size int64, err error)
	Delete(ctx context.Context, key string) error
	Put(ctx context.Context, key, contentType string, body io.Reader, size int64) error
}
