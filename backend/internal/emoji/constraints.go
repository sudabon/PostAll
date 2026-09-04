package emoji

import (
	"fmt"
	"regexp"
	"strings"
)

// カタログへ登録できる画像の制約。`emoji/` の一括登録と要求経路の登録が
// 同じ値を見るよう、ここを単一の正とする。
const (
	// MaxImageBytes は 1 件の画像の上限サイズ。
	MaxImageBytes = 512 * 1024

	contentTypePNG = "image/png"
	contentTypeGIF = "image/gif"
)

// acceptedContentTypes は要求経路で受け付ける画像形式と、保存キーに使う拡張子。
var acceptedContentTypes = map[string]string{
	contentTypePNG: "png",
	contentTypeGIF: "gif",
}

var shortcodePattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$`)

// ValidShortcode はショートコードとして使える文字列かを返す。
func ValidShortcode(shortcode string) bool {
	return shortcodePattern.MatchString(shortcode)
}

// MaxImageKiB は上限サイズを KiB で返す。利用者向けの文言に使う。
func MaxImageKiB() int {
	return MaxImageBytes / 1024
}

// AcceptedContentTypes は受け付ける形式を安定した順序で返す。
func AcceptedContentTypes() []string {
	return []string{contentTypePNG, contentTypeGIF}
}

func acceptedContentTypesText() string {
	return strings.Join(AcceptedContentTypes(), " / ")
}

func shortcodeRuleText() string {
	return "英数字・_・- が使えます。先頭は英数字で、長さは 1〜64 文字です"
}

func maxImageText() string {
	return fmt.Sprintf("%d KiB", MaxImageKiB())
}
