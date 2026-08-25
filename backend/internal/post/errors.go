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
