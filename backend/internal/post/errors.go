package post

import "net/http"

type Error struct {
	Code    string
	Message string
	Details map[string]any
	Status  int
}

func (e *Error) Error() string {
	if e == nil {
		return ""
	}
	return e.Code + ": " + e.Message
}

func errValidation(msg string) *Error {
	return &Error{Code: "validation", Message: msg, Status: http.StatusBadRequest}
}

func errNotFound(msg string) *Error {
	return &Error{Code: "not_found", Message: msg, Status: http.StatusNotFound}
}

func errDeleted() *Error {
	return &Error{Code: "post_deleted", Message: "削除済みのポストは編集できません", Status: http.StatusConflict}
}

func errEmptyContent() *Error {
	return &Error{Code: "empty_content", Message: "本文または添付のいずれかが必要です", Status: http.StatusBadRequest}
}

func errEncryptionRequired() *Error {
	return &Error{Code: "encryption_required", Message: "暗号化チャネルには暗号文で投稿してください", Status: http.StatusBadRequest}
}

func errEncryptionNotAllowed() *Error {
	return &Error{Code: "encryption_not_allowed", Message: "非暗号化チャネルには暗号文を投稿できません", Status: http.StatusBadRequest}
}

func errEncryptedAttachments() *Error {
	return &Error{
		Code:    "encrypted_attachments_unsupported",
		Message: "暗号化チャネルのポストには添付を付けられません",
		Status:  http.StatusBadRequest,
	}
}

func errInvalidCiphertext() *Error {
	return &Error{Code: "invalid_ciphertext", Message: "暗号文の形式または鍵が不正です", Status: http.StatusBadRequest}
}

func errEncryptionNotConfigured() *Error {
	return &Error{Code: "encryption_not_configured", Message: "暗号化の鍵が設定されていません", Status: http.StatusConflict}
}
