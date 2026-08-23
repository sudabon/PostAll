package search

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

func errValidation(message string) *Error {
	return &Error{Code: "validation", Message: message, Status: http.StatusBadRequest}
}
