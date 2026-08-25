package httpapi

import (
	"context"
	"log/slog"
	"net/http"
	"net/url"
	"regexp"

	"github.com/google/uuid"
)

const requestIDHeader = "X-Request-ID"

type requestIDContextKey struct{}

var loggedURLPattern = regexp.MustCompile(`https?://[^\s"'<>]+`)

func requestIDMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestID := r.Header.Get(requestIDHeader)
		parsed, err := uuid.Parse(requestID)
		if err != nil {
			parsed = uuid.New()
		}
		requestID = parsed.String()
		w.Header().Set(requestIDHeader, requestID)
		ctx := context.WithValue(r.Context(), requestIDContextKey{}, requestID)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func requestIDFromContext(ctx context.Context) string {
	requestID, _ := ctx.Value(requestIDContextKey{}).(string)
	return requestID
}

func logUnexpected(r *http.Request, err error) {
	if err == nil {
		return
	}
	slog.ErrorContext(r.Context(), "unexpected HTTP request failure",
		"request_id", requestIDFromContext(r.Context()),
		"method", r.Method,
		"path", r.URL.Path,
		"error", safeLogError(err),
	)
}

func safeLogError(err error) string {
	if err == nil {
		return ""
	}
	return loggedURLPattern.ReplaceAllStringFunc(err.Error(), func(raw string) string {
		parsed, parseErr := url.Parse(raw)
		if parseErr != nil {
			return "[redacted-url]"
		}
		parsed.RawQuery = ""
		parsed.ForceQuery = false
		parsed.Fragment = ""
		return parsed.String()
	})
}
