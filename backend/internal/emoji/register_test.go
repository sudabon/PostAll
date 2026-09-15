package emoji_test

import (
	"bytes"
	"context"
	"errors"
	"image"
	"image/color"
	"image/gif"
	"image/png"
	"net/http"
	"strings"
	"testing"

	"github.com/sudabon/PostAll/backend/internal/blob"
	emojisync "github.com/sudabon/PostAll/backend/internal/emoji"
)

// tinyPNG / tinyGIF は 1x1 の実物の画像を返す。形式の判定は実体のシグネチャを
// 見るので、テストでも本物のバイト列を使う。
func tinyPNG(t *testing.T) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, 1, 1))
	img.Set(0, 0, color.RGBA{R: 0x33, G: 0x99, B: 0xff, A: 0xff})
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func tinyGIF(t *testing.T) []byte {
	t.Helper()
	img := image.NewPaletted(image.Rect(0, 0, 1, 1), color.Palette{color.Black, color.White})
	var buf bytes.Buffer
	if err := gif.Encode(&buf, img, nil); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func appError(t *testing.T, err error) *emojisync.Error {
	t.Helper()
	var appErr *emojisync.Error
	if !errors.As(err, &appErr) {
		t.Fatalf("err = %v, want *emoji.Error", err)
	}
	return appErr
}

// 実体に触る前に弾かれる経路は、データベースもストレージも要らない。
func TestRegisterRejectsBeforeTouchingStorage(t *testing.T) {
	service := emojisync.NewService(nil)
	valid := tinyPNG(t)

	cases := []struct {
		name      string
		shortcode string
		image     []byte
		wantCode  string
		wantHTTP  int
	}{
		{"空のショートコード", "", valid, "invalid_shortcode", http.StatusBadRequest},
		{"先頭が記号", "-shipit", valid, "invalid_shortcode", http.StatusBadRequest},
		{"使えない文字", "party parrot", valid, "invalid_shortcode", http.StatusBadRequest},
		{"長すぎるショートコード", strings.Repeat("a", 65), valid, "invalid_shortcode", http.StatusBadRequest},
		{"画像なし", "shipit", nil, "image_required", http.StatusBadRequest},
		{"上限超過", "shipit", make([]byte, emojisync.MaxImageBytes+1), "image_too_large", http.StatusRequestEntityTooLarge},
		{"PNG でも GIF でもない", "shipit", []byte("これは画像ではありません"), "unsupported_image", http.StatusBadRequest},
		{"JPEG は対象外", "shipit", jpegSignature(), "unsupported_image", http.StatusBadRequest},
		{"SVG は対象外", "shipit", []byte(`<svg xmlns="http://www.w3.org/2000/svg"></svg>`), "unsupported_image", http.StatusBadRequest},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			objects := blob.NewMemory()
			_, err := service.Register(context.Background(), objects, tc.shortcode, tc.image)
			appErr := appError(t, err)
			if appErr.Code != tc.wantCode {
				t.Errorf("code = %q, want %q", appErr.Code, tc.wantCode)
			}
			if appErr.Status != tc.wantHTTP {
				t.Errorf("status = %d, want %d", appErr.Status, tc.wantHTTP)
			}
			if keys := objects.Keys(); len(keys) != 0 {
				t.Errorf("拒否された要求でオブジェクトが置かれている: %v", keys)
			}
		})
	}
}

// 形式もサイズも妥当でも、保存先が無ければ登録は成立しない。
func TestRegisterRequiresStorage(t *testing.T) {
	service := emojisync.NewService(nil)
	_, err := service.Register(context.Background(), nil, "shipit", tinyPNG(t))
	appErr := appError(t, err)
	if appErr.Code != "unavailable" {
		t.Errorf("code = %q, want %q", appErr.Code, "unavailable")
	}
	if appErr.Status != http.StatusServiceUnavailable {
		t.Errorf("status = %d, want %d", appErr.Status, http.StatusServiceUnavailable)
	}
}

func jpegSignature() []byte {
	// JFIF ヘッダ。http.DetectContentType が image/jpeg と判定する最小の形。
	return []byte{0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 'J', 'F', 'I', 'F', 0x00}
}
