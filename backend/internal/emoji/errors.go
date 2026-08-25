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
