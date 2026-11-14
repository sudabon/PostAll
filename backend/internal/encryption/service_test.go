package encryption

import (
	"encoding/base64"
	"errors"
	"strings"
	"testing"
)

func b64(n int) string {
	return base64.RawURLEncoding.EncodeToString(make([]byte, n))
}

func intPtr(n int) *int       { return &n }
func strPtr(s string) *string { return &s }

func passphraseWrap() Wrap {
	return Wrap{Kdf: kdfPBKDF2, Iterations: intPtr(600_000), Salt: b64(16), Iv: b64(12), Wrapped: b64(48)}
}

func recoveryWrap() Wrap {
	return Wrap{Kdf: kdfHKDF, Info: strPtr("postall:wrap:recovery"), Salt: b64(16), Iv: b64(12), Wrapped: b64(48)}
}

func errCode(err error) string {
	var e *Error
	if errors.As(err, &e) {
		return e.Code
	}
	return ""
}

func TestEncodeWrapAcceptsWellFormedWraps(t *testing.T) {
	if _, err := encodeWrap(KindPassphrase, passphraseWrap()); err != nil {
		t.Fatalf("passphrase wrap: %v", err)
	}
	if _, err := encodeWrap(KindRecovery, recoveryWrap()); err != nil {
		t.Fatalf("recovery wrap: %v", err)
	}
}

func TestEncodeWrapRejectsWeakOrBrokenWraps(t *testing.T) {
	cases := map[string]struct {
		kind string
		wrap func() Wrap
	}{
		"too few iterations":  {KindPassphrase, func() Wrap { w := passphraseWrap(); w.Iterations = intPtr(100_000); return w }},
		"missing iterations":  {KindPassphrase, func() Wrap { w := passphraseWrap(); w.Iterations = nil; return w }},
		"hkdf for passphrase": {KindPassphrase, func() Wrap { return recoveryWrap() }},
		"pbkdf2 for recovery": {KindRecovery, func() Wrap { return passphraseWrap() }},
		"empty info":          {KindRecovery, func() Wrap { w := recoveryWrap(); w.Info = strPtr(""); return w }},
		"short salt":          {KindPassphrase, func() Wrap { w := passphraseWrap(); w.Salt = b64(8); return w }},
		"wrong iv length":     {KindPassphrase, func() Wrap { w := passphraseWrap(); w.Iv = b64(16); return w }},
		"truncated wrapped":   {KindRecovery, func() Wrap { w := recoveryWrap(); w.Wrapped = b64(32); return w }},
		"not base64url":       {KindRecovery, func() Wrap { w := recoveryWrap(); w.Iv = "+/+/+/+/+/+/+/+/"; return w }},
		"unknown kind":        {"master", func() Wrap { return passphraseWrap() }},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			if _, err := encodeWrap(tc.kind, tc.wrap()); errCode(err) != "validation" {
				t.Fatalf("err=%v, want validation", err)
			}
		})
	}
}

func TestDecodeProofRequires32Bytes(t *testing.T) {
	if _, err := decodeProof(b64(32)); err != nil {
		t.Fatalf("32-byte proof: %v", err)
	}
	for _, raw := range []string{"", b64(31), b64(33), strings.Repeat("!", 43)} {
		if _, err := decodeProof(raw); err == nil {
			t.Fatalf("proof %q accepted", raw)
		}
	}
}

func TestEnvelopeKeyID(t *testing.T) {
	const keyID = "0b6c5c1e-8d2a-4f7e-9c3b-1a2b3c4d5e6f"
	id, ok := EnvelopeKeyID("pe1." + keyID + ".AAAAAAAAAAAAAAAA.c2VjcmV0")
	if !ok || id.String() != keyID {
		t.Fatalf("id=%s ok=%v", id, ok)
	}
	for _, bad := range []string{
		"",
		"pe1",
		"pe0." + keyID + ".AAAAAAAAAAAAAAAA.c2VjcmV0",
		"pe1.not-a-uuid.AAAAAAAAAAAAAAAA.c2VjcmV0",
		"pe1." + strings.ToUpper(keyID) + ".AAAAAAAAAAAAAAAA.c2VjcmV0",
		"pe1." + keyID + ".AAAAAAAAAAAAAAA.c2VjcmV0",
		"pe1." + keyID + ".AAAAAAAAAAAAAAAA.",
		"pe1." + keyID + ".AAAAAAAAAAAAAAAA.c2Vj cmV0",
		"pe1." + keyID + ".AAAAAAAAAAAAAAAA." + strings.Repeat("A", MaxCiphertextBytes),
	} {
		if _, ok := EnvelopeKeyID(bad); ok {
			t.Errorf("accepted %q", bad[:min(len(bad), 80)])
		}
	}
}
