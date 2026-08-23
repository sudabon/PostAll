package channel

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

func errNameConflict() *Error {
	return &Error{Code: "name_conflict", Message: "同じ階層に同名のチャネルが既にあります", Status: http.StatusConflict}
}

func errCycle() *Error {
	return &Error{Code: "cycle", Message: "自身または子孫を親にすることはできません", Status: http.StatusConflict}
}

func errHasPosts(count int64) *Error {
	return &Error{
		Code:    "channel_has_posts",
		Message: "ポストが存在するため削除できません",
		Details: map[string]any{"count": count},
		Status:  http.StatusConflict,
	}
}
