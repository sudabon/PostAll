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
	"golang.org/x/sync/singleflight"
)

var (
	ErrUnauthorized = errors.New("unauthorized")
	ErrUnknownKID   = errors.New("unknown key id")
)

const (
	defaultUnknownKIDTTL             = time.Minute
	defaultUnknownKIDRefreshCooldown = 5 * time.Second
	defaultMaxUnknownKIDs            = 256
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

	mu                    sync.RWMutex
	keys                  map[string]*rsa.PublicKey
	unknownKIDs           map[string]time.Time
	lastUnknownKIDRefresh time.Time
	unknownKIDTTL         time.Duration
	unknownKIDCooldown    time.Duration
	maxUnknownKIDs        int
	now                   func() time.Time
	refreshGroup          singleflight.Group
}

func NewVerifier(region, userPoolID, clientID string, client *http.Client) *Verifier {
	if client == nil {
		client = &http.Client{Timeout: 10 * time.Second}
	}
	return &Verifier{
		jwksURL:            fmt.Sprintf("https://cognito-idp.%s.amazonaws.com/%s/.well-known/jwks.json", region, userPoolID),
		issuer:             fmt.Sprintf("https://cognito-idp.%s.amazonaws.com/%s", region, userPoolID),
		audience:           clientID,
		client:             client,
		keys:               map[string]*rsa.PublicKey{},
		unknownKIDs:        map[string]time.Time{},
		unknownKIDTTL:      defaultUnknownKIDTTL,
		unknownKIDCooldown: defaultUnknownKIDRefreshCooldown,
		maxUnknownKIDs:     defaultMaxUnknownKIDs,
		now:                time.Now,
	}
}

func NewVerifierFromURL(jwksURL, issuer, audience string, client *http.Client) *Verifier {
	if client == nil {
		client = &http.Client{Timeout: 10 * time.Second}
	}
	return &Verifier{
		jwksURL:            jwksURL,
		issuer:             issuer,
		audience:           audience,
		client:             client,
		keys:               map[string]*rsa.PublicKey{},
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
		if _, ok := t.Method.(*jwt.SigningMethodRSA); !ok {
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
	}, jwt.WithIssuer(v.issuer), jwt.WithExpirationRequired(), jwt.WithIssuedAt())
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
	return Claims{Subject: sub, ClientID: v.audience, TokenUse: tokenUse}, nil
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
		return ctx.Err()
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
