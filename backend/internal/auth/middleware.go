package auth

import (
	"context"
	"crypto/subtle"
	"net/http"
	"strings"
)

type contextKey struct{}

type Principal struct {
	UserID      string
	AuthSubject string
}

func WithPrincipal(ctx context.Context, p Principal) context.Context {
	return context.WithValue(ctx, contextKey{}, p)
}

func PrincipalFrom(ctx context.Context) (Principal, bool) {
	p, ok := ctx.Value(contextKey{}).(Principal)
	return p, ok
}

type UserStore interface {
	ResolveByAuthSubject(ctx context.Context, sub string) (userID string, err error)
}

func Middleware(v *Verifier, users UserStore) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if skipAuth(r.URL.Path) {
				next.ServeHTTP(w, r)
				return
			}
			if v == nil {
				writeUnauthorized(w)
				return
			}
			raw := BearerToken(r.Header.Get("Authorization"))
			claims, err := v.Verify(r.Context(), raw)
			if err != nil {
				writeUnauthorized(w)
				return
			}
			if users == nil {
				writeJSON(w, http.StatusServiceUnavailable, `{"code":"unavailable","message":"データベースに接続できません"}`)
				return
			}
			userID, err := users.ResolveByAuthSubject(r.Context(), claims.Subject)
			if err != nil {
				writeJSON(w, http.StatusServiceUnavailable, `{"code":"unavailable","message":"ユーザーを登録できませんでした"}`)
				return
			}
			ctx := WithPrincipal(r.Context(), Principal{UserID: userID, AuthSubject: claims.Subject})
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

func skipAuth(path string) bool {
	return path == "/health" || path == "/ready" || strings.HasPrefix(path, "/internal/")
}

func writeUnauthorized(w http.ResponseWriter) {
	writeJSON(w, http.StatusUnauthorized, `{"code":"unauthorized","message":"認可情報を検証できませんでした"}`)
}

func writeJSON(w http.ResponseWriter, status int, body string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_, _ = w.Write([]byte(body))
}

func BearerMatches(header, secret string) bool {
	if secret == "" {
		return false
	}
	want := "Bearer " + secret
	if subtle.ConstantTimeCompare([]byte(header), []byte(want)) == 1 {
		return true
	}
	return false
}
