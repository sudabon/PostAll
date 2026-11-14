package encryption

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

func errValidation(msg string) *Error {
	return &Error{Code: "validation", Message: msg, Status: http.StatusBadRequest}
}

func errNotConfigured() *Error {
	return &Error{Code: "encryption_not_configured", Message: "暗号化の鍵が設定されていません", Status: http.StatusNotFound}
}

func errAlreadyConfigured() *Error {
	return &Error{Code: "encryption_already_configured", Message: "暗号化の鍵は既に設定されています", Status: http.StatusConflict}
}

func errKeyProofMismatch() *Error {
	return &Error{Code: "key_proof_mismatch", Message: "鍵の所持を確認できませんでした", Status: http.StatusForbidden}
}
