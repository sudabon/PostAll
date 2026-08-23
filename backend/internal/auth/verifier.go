package auth

import (
	"context"
	"crypto/rsa"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math/big"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

var (
	ErrUnauthorized = errors.New("unauthorized")
	ErrUnknownKID   = errors.New("unknown key id")
)

type Claims struct {
	Subject  string
	ClientID string
	TokenUse string
}

type Verifier struct {
	jwksURL  string
	issuer   string
	audience string
	client   *http.Client

	mu   sync.RWMutex
	keys map[string]*rsa.PublicKey
}

func NewVerifier(region, userPoolID, clientID string, client *http.Client) *Verifier {
	if client == nil {
		client = &http.Client{Timeout: 10 * time.Second}
	}
	return &Verifier{
		jwksURL:  fmt.Sprintf("https://cognito-idp.%s.amazonaws.com/%s/.well-known/jwks.json", region, userPoolID),
		issuer:   fmt.Sprintf("https://cognito-idp.%s.amazonaws.com/%s", region, userPoolID),
		audience: clientID,
		client:   client,
		keys:     map[string]*rsa.PublicKey{},
	}
}

func NewVerifierFromURL(jwksURL, issuer, audience string, client *http.Client) *Verifier {
	if client == nil {
		client = &http.Client{Timeout: 10 * time.Second}
	}
	return &Verifier{
		jwksURL:  jwksURL,
		issuer:   issuer,
		audience: audience,
		client:   client,
		keys:     map[string]*rsa.PublicKey{},
	}
}

func (v *Verifier) Verify(ctx context.Context, raw string) (Claims, error) {
	if raw == "" {
		return Claims{}, ErrUnauthorized
	}
	claims, err := v.parse(ctx, raw, false)
	if err == nil {
		return claims, nil
	}
	if !errors.Is(err, ErrUnknownKID) {
		return Claims{}, ErrUnauthorized
	}
	if err := v.refresh(ctx); err != nil {
		return Claims{}, ErrUnauthorized
	}
	claims, err = v.parse(ctx, raw, true)
	if err != nil {
		return Claims{}, ErrUnauthorized
	}
	return claims, nil
}

func (v *Verifier) parse(ctx context.Context, raw string, refreshed bool) (Claims, error) {
	token, err := jwt.Parse(raw, func(t *jwt.Token) (any, error) {
		if _, ok := t.Method.(*jwt.SigningMethodRSA); !ok {
			return nil, ErrUnauthorized
		}
		kid, _ := t.Header["kid"].(string)
		v.mu.RLock()
		key, ok := v.keys[kid]
		v.mu.RUnlock()
		if ok {
			return key, nil
		}
		if refreshed {
			return nil, ErrUnknownKID
		}
		return nil, ErrUnknownKID
	}, jwt.WithIssuer(v.issuer), jwt.WithExpirationRequired(), jwt.WithIssuedAt())
	if err != nil {
		if errors.Is(err, ErrUnknownKID) {
			return Claims{}, ErrUnknownKID
		}
		return Claims{}, ErrUnauthorized
	}
	mapClaims, ok := token.Claims.(jwt.MapClaims)
	if !ok || !token.Valid {
		return Claims{}, ErrUnauthorized
	}
	sub, _ := mapClaims["sub"].(string)
	if sub == "" {
		return Claims{}, ErrUnauthorized
	}
	tokenUse, _ := mapClaims["token_use"].(string)
	switch tokenUse {
	case "id":
		aud, _ := mapClaims["aud"].(string)
		if aud == "" {
			if list, ok := mapClaims["aud"].([]any); ok && len(list) > 0 {
				aud, _ = list[0].(string)
			}
		}
		if aud != v.audience {
			return Claims{}, ErrUnauthorized
		}
	case "access":
		cid, _ := mapClaims["client_id"].(string)
		if cid != v.audience {
			return Claims{}, ErrUnauthorized
		}
	default:
		return Claims{}, ErrUnauthorized
	}
	_ = ctx
	return Claims{Subject: sub, ClientID: v.audience, TokenUse: tokenUse}, nil
}

type jwksDoc struct {
	Keys []jwk `json:"keys"`
}

type jwk struct {
	Kid string `json:"kid"`
	Kty string `json:"kty"`
	N   string `json:"n"`
	E   string `json:"e"`
}

func (v *Verifier) refresh(ctx context.Context) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, v.jwksURL, nil)
	if err != nil {
		return err
	}
	resp, err := v.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("jwks status %d", resp.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return err
	}
	var doc jwksDoc
	if err := json.Unmarshal(body, &doc); err != nil {
		return err
	}
	next := make(map[string]*rsa.PublicKey, len(doc.Keys))
	for _, k := range doc.Keys {
		if k.Kty != "RSA" || k.Kid == "" {
			continue
		}
		pub, err := rsaPublicKey(k.N, k.E)
		if err != nil {
			continue
		}
		next[k.Kid] = pub
	}
	if len(next) == 0 {
		return errors.New("empty jwks")
	}
	v.mu.Lock()
	v.keys = next
	v.mu.Unlock()
	return nil
}

func rsaPublicKey(nB64, eB64 string) (*rsa.PublicKey, error) {
	nb, err := base64.RawURLEncoding.DecodeString(nB64)
	if err != nil {
		return nil, err
	}
	eb, err := base64.RawURLEncoding.DecodeString(eB64)
	if err != nil {
		return nil, err
	}
	n := new(big.Int).SetBytes(nb)
	e := 0
	for _, b := range eb {
		e = e<<8 + int(b)
	}
	if e == 0 {
		return nil, errors.New("invalid exponent")
	}
	return &rsa.PublicKey{N: n, E: e}, nil
}

func BearerToken(header string) string {
	const prefix = "Bearer "
	if !strings.HasPrefix(header, prefix) {
		return ""
	}
	return strings.TrimSpace(strings.TrimPrefix(header, prefix))
}
