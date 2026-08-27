package auth

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
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

	v := NewVerifierFromURL(srv.URL, "https://issuer.example", "authenticated", srv.Client())
	tok := mint(t, key, kid, validClaims("user-sub"))

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
	v := NewVerifierFromURL(srv.URL, "https://issuer.example", "authenticated", srv.Client())
	tok := mint(t, key, kid, jwt.MapClaims{
		"iss":  "https://issuer.example",
		"sub":  "user-sub",
		"aud":  "other",
		"role": "authenticated",
		"exp":  time.Now().Add(time.Hour).Unix(),
		"iat":  time.Now().Unix(),
	})
	if _, err := v.Verify(t.Context(), tok); err == nil {
		t.Fatal("expected rejection")
	}
}

func TestRejectsWrongRole(t *testing.T) {
	key, jwks, kid := testKey(t)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write(jwks)
	}))
	t.Cleanup(srv.Close)
	v := NewVerifierFromURL(srv.URL, "https://issuer.example", "authenticated", srv.Client())
	tok := mint(t, key, kid, jwt.MapClaims{
		"iss":  "https://issuer.example",
		"sub":  "user-sub",
		"aud":  "authenticated",
		"role": "anon",
		"exp":  time.Now().Add(time.Hour).Unix(),
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
	v := NewVerifierFromURL(srv.URL, "https://issuer.example", "authenticated", srv.Client())
	tok := mint(t, key, kid, jwt.MapClaims{
		"iss":  "https://issuer.example",
		"sub":  "user-sub",
		"aud":  "authenticated",
		"role": "authenticated",
		"exp":  time.Now().Add(-time.Hour).Unix(),
		"iat":  time.Now().Add(-2 * time.Hour).Unix(),
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
	v := NewVerifierFromURL(srv.URL, "https://issuer.example", "authenticated", srv.Client())

	oldTok := mint(t, oldKey, oldKID, validClaims("a"))
	if _, err := v.Verify(t.Context(), oldTok); err != nil {
		t.Fatal(err)
	}

	newTok := mint(t, newKey, newKID, validClaims("b"))
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

func TestConcurrentUnknownKIDRefreshesJWKSOnce(t *testing.T) {
	_, jwks, _ := testKey(t)
	unknownKey, _, _ := testKey(t)
	var hits atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits.Add(1)
		time.Sleep(25 * time.Millisecond)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write(jwks)
	}))
	t.Cleanup(srv.Close)

	v := NewVerifierFromURL(srv.URL, "https://issuer.example", "authenticated", srv.Client())
	tok := mint(t, unknownKey, "unknown-kid", validClaims("attacker"))

	const requests = 20
	start := make(chan struct{})
	var wg sync.WaitGroup
	wg.Add(requests)
	for range requests {
		go func() {
			defer wg.Done()
			<-start
			_, _ = v.Verify(t.Context(), tok)
		}()
	}
	close(start)
	wg.Wait()

	if got := hits.Load(); got != 1 {
		t.Fatalf("jwks hits=%d, want 1 for concurrent unknown kid", got)
	}
}

func TestConcurrentRotatedKIDRefreshesOnceAndVerifiesAllTokens(t *testing.T) {
	oldKey, oldJWKS, oldKID := testKey(t)
	newKey, newJWKS, newKID := testKey(t)
	var hits atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if hits.Add(1) == 1 {
			_, _ = w.Write(oldJWKS)
			return
		}
		time.Sleep(25 * time.Millisecond)
		_, _ = w.Write(newJWKS)
	}))
	t.Cleanup(srv.Close)

	v := NewVerifierFromURL(srv.URL, "https://issuer.example", "authenticated", srv.Client())
	oldToken := mint(t, oldKey, oldKID, validClaims("old"))
	if _, err := v.Verify(t.Context(), oldToken); err != nil {
		t.Fatal(err)
	}
	newToken := mint(t, newKey, newKID, validClaims("new"))

	const requests = 20
	start := make(chan struct{})
	results := make(chan error, requests)
	for range requests {
		go func() {
			<-start
			_, err := v.Verify(t.Context(), newToken)
			results <- err
		}()
	}
	close(start)
	for range requests {
		if err := <-results; err != nil {
			t.Fatalf("rotated token verification: %v", err)
		}
	}

	if got := hits.Load(); got != 2 {
		t.Fatalf("jwks hits=%d, want initial load plus one shared refresh", got)
	}
}

func TestRepeatedUnknownKIDUsesNegativeCache(t *testing.T) {
	_, jwks, _ := testKey(t)
	unknownKey, _, _ := testKey(t)
	var hits atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits.Add(1)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write(jwks)
	}))
	t.Cleanup(srv.Close)

	v := NewVerifierFromURL(srv.URL, "https://issuer.example", "authenticated", srv.Client())
	tok := mint(t, unknownKey, "unknown-kid", validClaims("attacker"))

	for range 5 {
		if _, err := v.Verify(t.Context(), tok); err == nil {
			t.Fatal("expected unknown kid to be rejected")
		}
	}
	if got := hits.Load(); got != 1 {
		t.Fatalf("jwks hits=%d, want 1 while unknown kid is cached", got)
	}
}

func TestUnknownKIDRefreshCooldownBoundsDistinctMisses(t *testing.T) {
	_, jwks, _ := testKey(t)
	unknownKey, _, _ := testKey(t)
	var hits atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits.Add(1)
		_, _ = w.Write(jwks)
	}))
	t.Cleanup(srv.Close)

	now := time.Unix(1_000, 0)
	v := NewVerifierFromURL(srv.URL, "https://issuer.example", "authenticated", srv.Client())
	v.now = func() time.Time { return now }
	v.unknownKIDCooldown = 10 * time.Second
	unknownToken := func(kid string) string {
		return mint(t, unknownKey, kid, validClaims("attacker"))
	}

	_, _ = v.Verify(t.Context(), unknownToken("unknown-a"))
	_, _ = v.Verify(t.Context(), unknownToken("unknown-b"))
	if got := hits.Load(); got != 1 {
		t.Fatalf("jwks hits=%d, want 1 during cooldown", got)
	}

	now = now.Add(v.unknownKIDCooldown)
	_, _ = v.Verify(t.Context(), unknownToken("unknown-b"))
	if got := hits.Load(); got != 2 {
		t.Fatalf("jwks hits=%d, want retry after cooldown", got)
	}
}

func TestUnknownKIDNegativeCacheIsBounded(t *testing.T) {
	_, jwks, _ := testKey(t)
	unknownKey, _, _ := testKey(t)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write(jwks)
	}))
	t.Cleanup(srv.Close)

	now := time.Unix(2_000, 0)
	v := NewVerifierFromURL(srv.URL, "https://issuer.example", "authenticated", srv.Client())
	v.now = func() time.Time { return now }
	v.unknownKIDCooldown = 0
	v.maxUnknownKIDs = 2
	for _, kid := range []string{"unknown-a", "unknown-b", "unknown-c", "unknown-d"} {
		tok := mint(t, unknownKey, kid, validClaims("attacker"))
		_, _ = v.Verify(t.Context(), tok)
		now = now.Add(time.Second)
	}

	v.mu.RLock()
	got := len(v.unknownKIDs)
	v.mu.RUnlock()
	if got != v.maxUnknownKIDs {
		t.Fatalf("cached unknown kids=%d, want %d", got, v.maxUnknownKIDs)
	}
}

func TestRejectsMissingBearer(t *testing.T) {
	v := NewVerifierFromURL("http://127.0.0.1:1/jwks", "https://issuer.example", "authenticated", nil)
	if _, err := v.Verify(t.Context(), ""); err == nil {
		t.Fatal("expected rejection")
	}
}

func TestRejectsHMACAlgConfusion(t *testing.T) {
	key, jwks, kid := testKey(t)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write(jwks)
	}))
	t.Cleanup(srv.Close)
	v := NewVerifierFromURL(srv.URL, "https://issuer.example", "authenticated", srv.Client())
	if _, err := v.Verify(t.Context(), mint(t, key, kid, validClaims("user-sub"))); err != nil {
		t.Fatal(err)
	}

	hmacTok := jwt.NewWithClaims(jwt.SigningMethodHS256, validClaims("attacker"))
	hmacTok.Header["kid"] = kid
	secret := elliptic.Marshal(elliptic.P256(), key.X, key.Y)
	signed, err := hmacTok.SignedString(secret)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := v.Verify(t.Context(), signed); err == nil {
		t.Fatal("expected HS256 token signed with JWKS key material to be rejected")
	}

	noneTok := jwt.NewWithClaims(jwt.SigningMethodNone, validClaims("attacker"))
	noneTok.Header["kid"] = kid
	noneSigned, err := noneTok.SignedString(jwt.UnsafeAllowNoneSignatureType)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := v.Verify(t.Context(), noneSigned); err == nil {
		t.Fatal("expected alg none token to be rejected")
	}
}

func validClaims(sub string) jwt.MapClaims {
	return jwt.MapClaims{
		"iss":  "https://issuer.example",
		"sub":  sub,
		"aud":  "authenticated",
		"role": "authenticated",
		"exp":  time.Now().Add(time.Hour).Unix(),
		"iat":  time.Now().Unix(),
	}
}

func testKey(t *testing.T) (*ecdsa.PrivateKey, []byte, string) {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	x := key.X.FillBytes(make([]byte, 32))
	y := key.Y.FillBytes(make([]byte, 32))
	kid := base64.RawURLEncoding.EncodeToString(x[:8])
	jwks, _ := json.Marshal(map[string]any{
		"keys": []map[string]string{{
			"kid": kid,
			"kty": "EC",
			"crv": "P-256",
			"alg": "ES256",
			"x":   base64.RawURLEncoding.EncodeToString(x),
			"y":   base64.RawURLEncoding.EncodeToString(y),
		}},
	})
	return key, jwks, kid
}

func mint(t *testing.T, key *ecdsa.PrivateKey, kid string, claims jwt.MapClaims) string {
	t.Helper()
	tok := jwt.NewWithClaims(jwt.SigningMethodES256, claims)
	tok.Header["kid"] = kid
	s, err := tok.SignedString(key)
	if err != nil {
		t.Fatal(err)
	}
	return s
}
