package attachment

import "strings"

var allowedTypes = map[string]struct{}{
	"image/jpeg": {},
	"image/png":  {},
	"image/gif":  {},
	"image/webp": {},
	"application/pdf": {},
	"text/plain":      {},
	"text/markdown":   {},
	"application/zip": {},
	"application/vnd.openxmlformats-officedocument.wordprocessingml.document":   {},
	"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":         {},
	"application/vnd.openxmlformats-officedocument.presentationml.presentation": {},
}

func Allowed(contentType string) bool {
	_, ok := allowedTypes[strings.ToLower(strings.TrimSpace(contentType))]
	return ok
}
