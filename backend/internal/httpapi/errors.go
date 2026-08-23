package httpapi

import (
	"net/http"

	"github.com/sudabon/PostAll/backend/internal/api"
)

func writeAPIError(w http.ResponseWriter, status int, code, message string, details map[string]any) {
	body := api.Error{Code: code, Message: message}
	if details != nil {
		body.Details = &details
	}
	writeJSON(w, status, body)
}
