package attachment

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

func errForbidden(msg string) *Error {
	return &Error{Code: "forbidden", Message: msg, Status: http.StatusForbidden}
}

func errTooLarge() *Error {
	return &Error{Code: "payload_too_large", Message: "ファイルサイズは 25 MiB 以下である必要があります", Status: http.StatusBadRequest}
}

func errBadType() *Error {
	return &Error{Code: "unsupported_media_type", Message: "このファイル形式は添付できません", Status: http.StatusBadRequest}
}

func errIncomplete() *Error {
	return &Error{Code: "upload_incomplete", Message: "アップロードが完了していません", Status: http.StatusBadRequest}
}

func errUnavailable() *Error {
	return &Error{Code: "unavailable", Message: "添付ストレージを利用できません", Status: http.StatusServiceUnavailable}
}
