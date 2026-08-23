package auth

import (
	"crypto/rand"
	"crypto/rsa"
	"encoding/base64"
	"encoding/json"
	"math/big"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

func TestVerifyAccessToken(t *testing.T) {
	key, jwks, kid := testKey(t)
	var hits int
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits++
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write(jwks)
	}))
	t.Cleanup(srv.Close)

	v := NewVerifierFromURL(srv.URL, "https://issuer.example", "client-1", srv.Client())
	tok := mint(t, key, kid, jwt.MapClaims{
		"iss":       "https://issuer.example",
		"sub":       "user-sub",
		"token_use": "access",
		"client_id": "client-1",
		"exp":       time.Now().Add(time.Hour).Unix(),
		"iat":       time.Now().Unix(),
	})

	got, err := v.Verify(t.Context(), tok)
	if err != nil {
		t.Fatal(err)
	}
	if got.Subject != "user-sub" {
		t.Fatalf("sub=%q", got.Subject)
	}
	if _, err := v.Verify(t.Context(), tok); err != nil {
		t.Fatal(err)
	}
	if hits != 1 {
		t.Fatalf("jwks hits=%d, want 1 (cached)", hits)
	}
}

func TestRejectsWrongAudience(t *testing.T) {
	key, jwks, kid := testKey(t)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write(jwks)
	}))
	t.Cleanup(srv.Close)
	v := NewVerifierFromURL(srv.URL, "https://issuer.example", "client-1", srv.Client())
	tok := mint(t, key, kid, jwt.MapClaims{
		"iss":       "https://issuer.example",
		"sub":       "user-sub",
		"token_use": "access",
		"client_id": "other",
		"exp":       time.Now().Add(time.Hour).Unix(),
	})
	if _, err := v.Verify(t.Context(), tok); err == nil {
		t.Fatal("expected rejection")
	}
}

func TestRejectsExpired(t *testing.T) {
	key, jwks, kid := testKey(t)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write(jwks)
	}))
	t.Cleanup(srv.Close)
	v := NewVerifierFromURL(srv.URL, "https://issuer.example", "client-1", srv.Client())
	tok := mint(t, key, kid, jwt.MapClaims{
		"iss":       "https://issuer.example",
		"sub":       "user-sub",
		"token_use": "access",
		"client_id": "client-1",
		"exp":       time.Now().Add(-time.Hour).Unix(),
	})
	if _, err := v.Verify(t.Context(), tok); err == nil {
		t.Fatal("expected rejection")
	}
}

func TestRefetchesOnUnknownKID(t *testing.T) {
	oldKey, oldJWKS, oldKID := testKey(t)
	newKey, newJWKS, newKID := testKey(t)
	var hits int
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits++
		if hits == 1 {
			_, _ = w.Write(oldJWKS)
			return
		}
		_, _ = w.Write(newJWKS)
	}))
	t.Cleanup(srv.Close)
	v := NewVerifierFromURL(srv.URL, "https://issuer.example", "client-1", srv.Client())

	oldTok := mint(t, oldKey, oldKID, jwt.MapClaims{
		"iss": "https://issuer.example", "sub": "a", "token_use": "access",
		"client_id": "client-1", "exp": time.Now().Add(time.Hour).Unix(),
	})
	if _, err := v.Verify(t.Context(), oldTok); err != nil {
		t.Fatal(err)
	}

	newTok := mint(t, newKey, newKID, jwt.MapClaims{
		"iss": "https://issuer.example", "sub": "b", "token_use": "id",
		"aud": "client-1", "exp": time.Now().Add(time.Hour).Unix(),
	})
	got, err := v.Verify(t.Context(), newTok)
	if err != nil {
		t.Fatal(err)
	}
	if got.Subject != "b" {
		t.Fatalf("sub=%q", got.Subject)
	}
	if hits != 2 {
		t.Fatalf("hits=%d want 2", hits)
	}
}

func TestRejectsMissingBearer(t *testing.T) {
	v := NewVerifierFromURL("http://127.0.0.1:1/jwks", "https://issuer.example", "client-1", nil)
	if _, err := v.Verify(t.Context(), ""); err == nil {
		t.Fatal("expected rejection")
	}
}

func testKey(t *testing.T) (*rsa.PrivateKey, []byte, string) {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	kid := base64.RawURLEncoding.EncodeToString(key.N.Bytes()[:8])
	jwks, _ := json.Marshal(map[string]any{
		"keys": []map[string]string{{
			"kid": kid,
			"kty": "RSA",
			"n":   base64.RawURLEncoding.EncodeToString(key.N.Bytes()),
			"e":   base64.RawURLEncoding.EncodeToString(big.NewInt(int64(key.E)).Bytes()),
		}},
	})
	return key, jwks, kid
}

func mint(t *testing.T, key *rsa.PrivateKey, kid string, claims jwt.MapClaims) string {
	t.Helper()
	tok := jwt.NewWithClaims(jwt.SigningMethodRS256, claims)
	tok.Header["kid"] = kid
	s, err := tok.SignedString(key)
	if err != nil {
		t.Fatal(err)
	}
	return s
}
