package auth

import (
	"context"
	"crypto"
	"crypto/ecdsa"
	"crypto/elliptic"
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
	"golang.org/x/sync/singleflight"
)

var (
	ErrUnauthorized    = errors.New("unauthorized")
	ErrUnknownKID      = errors.New("unknown key id")
	ErrJWKSUnavailable = errors.New("jwks unavailable")
)

const (
	defaultJWKSTimeout               = 8 * time.Second
	defaultUnknownKIDTTL             = time.Minute
	defaultUnknownKIDRefreshCooldown = 5 * time.Second
	defaultMaxUnknownKIDs            = 256
)

type Claims struct {
	Subject string
}

type Verifier struct {
	jwksURL  string
	issuer   string
	audience string
	client   *http.Client

	mu                    sync.RWMutex
	keys                  map[string]crypto.PublicKey
	unknownKIDs           map[string]time.Time
	lastUnknownKIDRefresh time.Time
	unknownKIDTTL         time.Duration
	unknownKIDCooldown    time.Duration
	maxUnknownKIDs        int
	now                   func() time.Time
	refreshGroup          singleflight.Group
}

func NewSupabaseVerifier(supabaseURL string, client *http.Client) *Verifier {
	base := strings.TrimRight(supabaseURL, "/")
	return NewVerifierFromURL(
		base+"/auth/v1/.well-known/jwks.json",
		base+"/auth/v1",
		"authenticated",
		client,
	)
}

func NewVerifierFromURL(jwksURL, issuer, audience string, client *http.Client) *Verifier {
	if client == nil {
		client = &http.Client{Timeout: defaultJWKSTimeout}
	} else if client.Timeout == 0 {
		clone := *client
		clone.Timeout = defaultJWKSTimeout
		client = &clone
	}
	return &Verifier{
		jwksURL:            jwksURL,
		issuer:             issuer,
		audience:           audience,
		client:             client,
		keys:               map[string]crypto.PublicKey{},
		unknownKIDs:        map[string]time.Time{},
		unknownKIDTTL:      defaultUnknownKIDTTL,
		unknownKIDCooldown: defaultUnknownKIDRefreshCooldown,
		maxUnknownKIDs:     defaultMaxUnknownKIDs,
		now:                time.Now,
	}
}

func (v *Verifier) Verify(ctx context.Context, raw string) (Claims, error) {
	if raw == "" {
		return Claims{}, ErrUnauthorized
	}
	claims, err := v.parse(raw)
	if err == nil {
		return claims, nil
	}
	var unknown *unknownKIDError
	if !errors.As(err, &unknown) {
		return Claims{}, ErrUnauthorized
	}
	if err := v.refreshForUnknownKID(ctx, unknown.kid); err != nil {
		if errors.Is(err, ErrJWKSUnavailable) {
			return Claims{}, err
		}
		return Claims{}, ErrUnauthorized
	}
	claims, err = v.parse(raw)
	if err != nil {
		return Claims{}, ErrUnauthorized
	}
	return claims, nil
}

type unknownKIDError struct {
	kid string
}

func (e *unknownKIDError) Error() string {
	return fmt.Sprintf("%s: %s", ErrUnknownKID, e.kid)
}

func (e *unknownKIDError) Unwrap() error {
	return ErrUnknownKID
}

func (v *Verifier) parse(raw string) (Claims, error) {
	token, err := jwt.Parse(raw, func(t *jwt.Token) (any, error) {
		if t.Method != jwt.SigningMethodES256 && t.Method != jwt.SigningMethodRS256 {
			return nil, ErrUnauthorized
		}
		kid, _ := t.Header["kid"].(string)
		if kid == "" {
			return nil, ErrUnauthorized
		}
		v.mu.RLock()
		key, ok := v.keys[kid]
		v.mu.RUnlock()
		if ok {
			return key, nil
		}
		return nil, &unknownKIDError{kid: kid}
	}, jwt.WithIssuer(v.issuer), jwt.WithAudience(v.audience), jwt.WithExpirationRequired(), jwt.WithIssuedAt())
	if err != nil {
		var unknown *unknownKIDError
		if errors.As(err, &unknown) {
			return Claims{}, unknown
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
	role, _ := mapClaims["role"].(string)
	if role != "authenticated" {
		return Claims{}, ErrUnauthorized
	}
	return Claims{Subject: sub}, nil
}

func (v *Verifier) refreshForUnknownKID(ctx context.Context, kid string) error {
	if v.hasKey(kid) {
		return nil
	}
	if v.suppressUnknownKIDRefresh(kid) {
		return ErrUnknownKID
	}

	result := v.refreshGroup.DoChan("jwks", func() (any, error) {
		if v.hasKey(kid) {
			return nil, nil
		}
		if v.suppressUnknownKIDRefresh(kid) {
			return nil, ErrUnknownKID
		}
		if err := v.refresh(ctx); err != nil {
			return nil, err
		}
		if !v.hasKey(kid) {
			v.rememberUnknownKID(kid)
			return nil, ErrUnknownKID
		}
		return nil, nil
	})

	select {
	case <-ctx.Done():
		return fmt.Errorf("%w: %v", ErrJWKSUnavailable, ctx.Err())
	case outcome := <-result:
		return outcome.Err
	}
}

func (v *Verifier) hasKey(kid string) bool {
	v.mu.RLock()
	_, ok := v.keys[kid]
	v.mu.RUnlock()
	return ok
}

func (v *Verifier) suppressUnknownKIDRefresh(kid string) bool {
	now := v.now()
	v.mu.Lock()
	defer v.mu.Unlock()
	v.pruneUnknownKIDsLocked(now)
	if _, ok := v.unknownKIDs[kid]; ok {
		return true
	}
	return !v.lastUnknownKIDRefresh.IsZero() && now.Sub(v.lastUnknownKIDRefresh) < v.unknownKIDCooldown
}

func (v *Verifier) rememberUnknownKID(kid string) {
	now := v.now()
	v.mu.Lock()
	defer v.mu.Unlock()
	v.pruneUnknownKIDsLocked(now)
	if _, exists := v.unknownKIDs[kid]; !exists && len(v.unknownKIDs) >= v.maxUnknownKIDs {
		var oldestKID string
		var oldestExpiry time.Time
		for candidate, expiry := range v.unknownKIDs {
			if oldestKID == "" || expiry.Before(oldestExpiry) {
				oldestKID = candidate
				oldestExpiry = expiry
			}
		}
		delete(v.unknownKIDs, oldestKID)
	}
	v.unknownKIDs[kid] = now.Add(v.unknownKIDTTL)
	v.lastUnknownKIDRefresh = now
}

func (v *Verifier) pruneUnknownKIDsLocked(now time.Time) {
	for kid, expiry := range v.unknownKIDs {
		if !expiry.After(now) {
			delete(v.unknownKIDs, kid)
		}
	}
}

type jwksDoc struct {
	Keys []jwk `json:"keys"`
}

type jwk struct {
	Kid string `json:"kid"`
	Kty string `json:"kty"`
	Crv string `json:"crv"`
	X   string `json:"x"`
	Y   string `json:"y"`
	N   string `json:"n"`
	E   string `json:"e"`
	Alg string `json:"alg"`
}

func (v *Verifier) refresh(ctx context.Context) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, v.jwksURL, nil)
	if err != nil {
		return err
	}
	resp, err := v.client.Do(req)
	if err != nil {
		return fmt.Errorf("%w: %v", ErrJWKSUnavailable, err)
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
	next := make(map[string]crypto.PublicKey, len(doc.Keys))
	for _, k := range doc.Keys {
		if k.Kid == "" {
			continue
		}
		switch k.Kty {
		case "EC":
			pub, err := ecdsaPublicKey(k.X, k.Y, k.Crv)
			if err != nil {
				continue
			}
			next[k.Kid] = pub
		case "RSA":
			pub, err := rsaPublicKey(k.N, k.E)
			if err != nil {
				continue
			}
			next[k.Kid] = pub
		}
	}
	if len(next) == 0 {
		return errors.New("empty jwks")
	}
	v.mu.Lock()
	v.keys = next
	for kid := range next {
		delete(v.unknownKIDs, kid)
	}
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
	var eInt int
	for _, b := range eb {
		eInt = eInt<<8 | int(b)
	}
	if eInt == 0 {
		return nil, errors.New("invalid rsa exponent")
	}
	return &rsa.PublicKey{
		N: new(big.Int).SetBytes(nb),
		E: eInt,
	}, nil
}

func ecdsaPublicKey(xB64, yB64, crv string) (*ecdsa.PublicKey, error) {
	if crv != "" && crv != "P-256" {
		return nil, fmt.Errorf("unsupported curve %s", crv)
	}
	xb, err := base64.RawURLEncoding.DecodeString(xB64)
	if err != nil {
		return nil, err
	}
	yb, err := base64.RawURLEncoding.DecodeString(yB64)
	if err != nil {
		return nil, err
	}
	return &ecdsa.PublicKey{
		Curve: elliptic.P256(),
		X:     new(big.Int).SetBytes(xb),
		Y:     new(big.Int).SetBytes(yb),
	}, nil
}

func BearerToken(header string) string {
	const prefix = "Bearer "
	if !strings.HasPrefix(header, prefix) {
		return ""
	}
	return strings.TrimSpace(strings.TrimPrefix(header, prefix))
}
