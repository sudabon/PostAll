package emoji

import (
	"net/http"
	"strings"
	"testing"
)

func TestValidShortcode(t *testing.T) {
	valid := []string{"a", "0", "shipit", "party-parrot", "snake_case", "A1", strings.Repeat("a", 64)}
	for _, shortcode := range valid {
		if !ValidShortcode(shortcode) {
			t.Errorf("ValidShortcode(%q) = false, want true", shortcode)
		}
	}

	invalid := []string{
		"",
		"-leading-hyphen",
		"_leading-underscore",
		"has space",
		"日本語",
		"dot.separated",
		"slash/separated",
		strings.Repeat("a", 65),
	}
	for _, shortcode := range invalid {
		if ValidShortcode(shortcode) {
			t.Errorf("ValidShortcode(%q) = true, want false", shortcode)
		}
	}
}

func TestAcceptedContentTypesIsStable(t *testing.T) {
	got := AcceptedContentTypes()
	want := []string{"image/png", "image/gif"}
	if len(got) != len(want) {
		t.Fatalf("AcceptedContentTypes() = %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("AcceptedContentTypes() = %v, want %v", got, want)
		}
	}
	for _, contentType := range want {
		if _, ok := acceptedContentTypes[contentType]; !ok {
			t.Errorf("acceptedContentTypes は %q を含んでいない", contentType)
		}
	}
}

func TestMaxImageBytesIs512KiB(t *testing.T) {
	if MaxImageBytes != 512*1024 {
		t.Fatalf("MaxImageBytes = %d, want %d", MaxImageBytes, 512*1024)
	}
	if MaxImageKiB() != 512 {
		t.Fatalf("MaxImageKiB() = %d, want 512", MaxImageKiB())
	}
}

func TestErrImageTooLargeMentionsTheLimit(t *testing.T) {
	err := errImageTooLarge()
	if err.Status != http.StatusRequestEntityTooLarge {
		t.Errorf("Status = %d, want %d", err.Status, http.StatusRequestEntityTooLarge)
	}
	if !strings.Contains(err.Message, "512 KiB") {
		t.Errorf("Message = %q, want it to contain the limit %q", err.Message, "512 KiB")
	}
}

func TestErrUnsupportedImageMentionsAcceptedFormats(t *testing.T) {
	err := errUnsupportedImage()
	if err.Status != http.StatusBadRequest {
		t.Errorf("Status = %d, want %d", err.Status, http.StatusBadRequest)
	}
	for _, contentType := range AcceptedContentTypes() {
		if !strings.Contains(err.Message, contentType) {
			t.Errorf("Message = %q, want it to contain %q", err.Message, contentType)
		}
	}
}

func TestErrInvalidShortcodeMentionsTheRule(t *testing.T) {
	err := errInvalidShortcode()
	if err.Status != http.StatusBadRequest {
		t.Errorf("Status = %d, want %d", err.Status, http.StatusBadRequest)
	}
	for _, fragment := range []string{"英数字", "_", "-", "1〜64"} {
		if !strings.Contains(err.Message, fragment) {
			t.Errorf("Message = %q, want it to contain %q", err.Message, fragment)
		}
	}
}

func TestErrShortcodeConflictNamesTheShortcode(t *testing.T) {
	err := errShortcodeConflict("shipit")
	if err.Status != http.StatusConflict {
		t.Errorf("Status = %d, want %d", err.Status, http.StatusConflict)
	}
	if err.Code != "shortcode_conflict" {
		t.Errorf("Code = %q, want %q", err.Code, "shortcode_conflict")
	}
	if !strings.Contains(err.Message, "shipit") {
		t.Errorf("Message = %q, want it to name the conflicting shortcode", err.Message)
	}
}
