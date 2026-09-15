package emoji

import "net/http"

type Error struct {
	Code    string
	Message string
	Status  int
}

func (e *Error) Error() string {
	if e == nil {
		return ""
	}
	return e.Code + ": " + e.Message
}

func errNotFound(message string) *Error {
	return &Error{Code: "not_found", Message: message, Status: http.StatusNotFound}
}

func errPostDeleted() *Error {
	return &Error{Code: "post_deleted", Message: "削除済みのポストにはリアクションできません", Status: http.StatusConflict}
}

func errInvalidShortcode() *Error {
	return &Error{
		Code:    "invalid_shortcode",
		Message: "ショートコードに使えない値です。" + shortcodeRuleText(),
		Status:  http.StatusBadRequest,
	}
}

func errShortcodeConflict(shortcode string) *Error {
	return &Error{
		Code:    "shortcode_conflict",
		Message: ":" + shortcode + ": は既に登録されています。別のショートコードにしてください",
		Status:  http.StatusConflict,
	}
}

func errUnsupportedImage() *Error {
	return &Error{
		Code:    "unsupported_image",
		Message: "対応していない画像形式です。" + acceptedContentTypesText() + " のいずれかにしてください",
		Status:  http.StatusBadRequest,
	}
}

func errImageTooLarge() *Error {
	return &Error{
		Code:    "image_too_large",
		Message: "画像が大きすぎます。" + maxImageText() + " 以下にしてください",
		Status:  http.StatusRequestEntityTooLarge,
	}
}

// ErrImageTooLarge は本文の読み取り段階で上限を超えたことを示す。上限値を含む
// 文言を呼び出し側で組み立て直さないよう公開する。
func ErrImageTooLarge() error {
	return errImageTooLarge()
}

func errStorageUnavailable() *Error {
	return &Error{
		Code:    "unavailable",
		Message: "画像の保存先に接続できません",
		Status:  http.StatusServiceUnavailable,
	}
}

func errImageRequired() *Error {
	return &Error{
		Code:    "image_required",
		Message: "画像ファイルを選んでください",
		Status:  http.StatusBadRequest,
	}
}
