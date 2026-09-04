package emoji

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"net/http"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/sudabon/PostAll/backend/internal/blob"
	"github.com/sudabon/PostAll/backend/internal/store"
)

// Register は要求経路から届いた画像を 1 件だけカタログへ登録する。
// `emoji/` の一括登録（Sync）と違い、形式はファイル名や申告された Content-Type
// ではなく実体の内容から判定する。
func (s *Service) Register(
	ctx context.Context,
	objects blob.Store,
	shortcode string,
	image []byte,
) (CatalogItem, error) {
	if !ValidShortcode(shortcode) {
		return CatalogItem{}, errInvalidShortcode()
	}
	if len(image) == 0 {
		return CatalogItem{}, errImageRequired()
	}
	if len(image) > MaxImageBytes {
		return CatalogItem{}, errImageTooLarge()
	}
	contentType := detectImageContentType(image)
	ext, accepted := acceptedContentTypes[contentType]
	if !accepted {
		return CatalogItem{}, errUnsupportedImage()
	}
	if objects == nil {
		return CatalogItem{}, errStorageUnavailable()
	}

	// 保存キーは登録ごとに一意にする。ショートコードから導くと、既存と重複した
	// 登録要求の Put が、insert が重複で失敗する前に既存スタンプの実体を
	// 上書きしてしまう。一括登録のファイル名キーと衝突しないよう接頭辞を付ける。
	key := "emojis/" + uuid.NewString() + "." + ext
	sum := sha256.Sum256(image)
	checksum := hex.EncodeToString(sum[:])

	if err := objects.Put(ctx, key, contentType, bytes.NewReader(image), int64(len(image))); err != nil {
		return CatalogItem{}, fmt.Errorf("put emoji object %s: %w", key, err)
	}
	row, err := s.q.InsertEmoji(ctx, store.InsertEmojiParams{
		Shortcode:  shortcode,
		StorageKey: key,
		Checksum:   checksum,
	})
	if err != nil {
		// ここで失敗すると実体だけが残るが、その保存キーを指す行が無いので
		// 一覧にも配信にも現れず、同じショートコードでの再登録も妨げない。
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			return CatalogItem{}, errShortcodeConflict(shortcode)
		}
		return CatalogItem{}, fmt.Errorf("insert emoji %s: %w", shortcode, err)
	}
	return catalogItem(row), nil
}

// detectImageContentType は先頭のシグネチャから画像形式を判定する。
// PNG と GIF のシグネチャはどちらも先頭 8 バイト以内にある。
func detectImageContentType(image []byte) string {
	return http.DetectContentType(image)
}
