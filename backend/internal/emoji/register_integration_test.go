package emoji_test

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/sudabon/PostAll/backend/internal/blob"
	emojisync "github.com/sudabon/PostAll/backend/internal/emoji"
	"github.com/sudabon/PostAll/backend/internal/store"
	"github.com/sudabon/PostAll/backend/internal/testutil"
)

func TestRegisterStoresPNGAndGIF(t *testing.T) {
	ctx := context.Background()
	pool := testPool(t)
	service := emojisync.NewService(store.New(pool))
	objects := blob.NewMemory()

	pngBytes := tinyPNG(t)
	pngItem, err := service.Register(ctx, objects, "uploaded-png", pngBytes)
	if err != nil {
		t.Fatal(err)
	}
	if pngItem.Shortcode != "uploaded-png" {
		t.Errorf("shortcode = %q, want %q", pngItem.Shortcode, "uploaded-png")
	}
	if pngItem.ID.String() == "" {
		t.Error("id が空")
	}
	if !strings.HasPrefix(pngItem.StorageKey, "emojis/") || !strings.HasSuffix(pngItem.StorageKey, ".png") {
		t.Errorf("storage key = %q, want emojis/<uuid>.png", pngItem.StorageKey)
	}
	if want := sha256Hex(pngBytes); pngItem.Checksum != want {
		t.Errorf("checksum = %q, want %q", pngItem.Checksum, want)
	}
	assertStored(t, objects, pngItem.StorageKey, pngBytes, "image/png")

	gifBytes := tinyGIF(t)
	gifItem, err := service.Register(ctx, objects, "uploaded-gif", gifBytes)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasSuffix(gifItem.StorageKey, ".gif") {
		t.Errorf("storage key = %q, want emojis/<uuid>.gif", gifItem.StorageKey)
	}
	assertStored(t, objects, gifItem.StorageKey, gifBytes, "image/gif")

	// 保存キーは登録ごとに一意で、一括登録のファイル名キーと衝突しない。
	if gifItem.StorageKey == pngItem.StorageKey {
		t.Error("保存キーが 2 件の登録で同じになっている")
	}

	// 一覧に両方現れる。
	items, err := service.List(ctx)
	if err != nil {
		t.Fatal(err)
	}
	found := map[string]bool{}
	for _, item := range items {
		found[item.Shortcode] = true
	}
	if !found["uploaded-png"] || !found["uploaded-gif"] {
		t.Fatalf("catalog = %+v, want uploaded-png と uploaded-gif を含む", items)
	}
}

func TestRegisterRejectsDuplicateShortcodeWithoutTouchingTheExisting(t *testing.T) {
	ctx := context.Background()
	pool := testPool(t)
	service := emojisync.NewService(store.New(pool))
	objects := blob.NewMemory()

	pngBytes := tinyPNG(t)
	existing, err := service.Register(ctx, objects, "shipit", pngBytes)
	if err != nil {
		t.Fatal(err)
	}
	keysBefore := objects.Keys()

	// 同じショートコードで、中身の違う画像を登録しようとする。
	_, err = service.Register(ctx, objects, "shipit", tinyGIF(t))
	appErr := appError(t, err)
	if appErr.Code != "shortcode_conflict" {
		t.Errorf("code = %q, want %q", appErr.Code, "shortcode_conflict")
	}
	if appErr.Status != http.StatusConflict {
		t.Errorf("status = %d, want %d", appErr.Status, http.StatusConflict)
	}
	if !strings.Contains(appErr.Message, "shipit") {
		t.Errorf("message = %q, want it to name the shortcode", appErr.Message)
	}

	// 既存の行は id / 保存キー / チェックサムとも変わらない。
	after, err := service.GetByShortcode(ctx, "shipit")
	if err != nil {
		t.Fatal(err)
	}
	if after.ID != existing.ID || after.StorageKey != existing.StorageKey || after.Checksum != existing.Checksum {
		t.Fatalf("既存行が変わった: before=%+v after=%+v", existing, after)
	}

	// 既存の実体も差し替わっていない。
	assertStored(t, objects, existing.StorageKey, pngBytes, "image/png")

	// 重複した要求は自分の分の実体を 1 件残す（カタログには現れない orphan）。
	// 既存のキーが消えていないことだけを保証する。
	for _, key := range keysBefore {
		if !objects.Has(key) {
			t.Errorf("既存のオブジェクト %q が消えている", key)
		}
	}
	if !strings.HasPrefix(existing.StorageKey, "emojis/") {
		t.Errorf("storage key = %q", existing.StorageKey)
	}

	// カタログは 1 件のまま。
	items, err := service.List(ctx)
	if err != nil {
		t.Fatal(err)
	}
	count := 0
	for _, item := range items {
		if item.Shortcode == "shipit" {
			count++
		}
	}
	if count != 1 {
		t.Fatalf("shipit の行が %d 件。1 件のはず", count)
	}
}

func TestRegisterAcceptsExactlyTheSizeLimit(t *testing.T) {
	ctx := context.Background()
	pool := testPool(t)
	service := emojisync.NewService(store.New(pool))
	objects := blob.NewMemory()

	// 先頭は PNG のシグネチャ、全体でちょうど上限サイズ。
	atLimit := make([]byte, emojisync.MaxImageBytes)
	copy(atLimit, tinyPNG(t))

	item, err := service.Register(ctx, objects, "at-limit", atLimit)
	if err != nil {
		t.Fatalf("上限値ちょうどが拒否された: %v", err)
	}
	if !objects.Has(item.StorageKey) {
		t.Fatalf("実体が置かれていない: %q", item.StorageKey)
	}

	overLimit := make([]byte, emojisync.MaxImageBytes+1)
	copy(overLimit, tinyPNG(t))
	if _, err := service.Register(ctx, objects, "over-limit", overLimit); appError(t, err).Code != "image_too_large" {
		t.Fatalf("上限値+1 が受理された: %v", err)
	}
}

func testPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	pool, err := pgxpool.New(context.Background(), testutil.PostgresURL(t))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	return pool
}

func sha256Hex(data []byte) string {
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}

func assertStored(t *testing.T, objects *blob.Memory, key string, want []byte, wantContentType string) {
	t.Helper()
	body, contentType, size, err := objects.Get(context.Background(), key)
	if err != nil {
		t.Fatalf("get %q: %v", key, err)
	}
	defer func() { _ = body.Close() }()
	got, err := io.ReadAll(body)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != string(want) {
		t.Errorf("%q の内容が置いたものと違う（%d バイト、期待 %d バイト）", key, len(got), len(want))
	}
	if size != int64(len(want)) {
		t.Errorf("%q のサイズ = %d, want %d", key, size, len(want))
	}
	if contentType != wantContentType {
		t.Errorf("%q の content type = %q, want %q", key, contentType, wantContentType)
	}
}
