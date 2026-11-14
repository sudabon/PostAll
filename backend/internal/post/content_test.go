package post

import (
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/sudabon/PostAll/backend/internal/store"
)

const testKeyID = "0b6c5c1e-8d2a-4f7e-9c3b-1a2b3c4d5e6f"

func ptr(s string) *string { return &s }

func validEnvelope() string {
	return "pe1." + testKeyID + ".AAAAAAAAAAAAAAAA.c2VjcmV0LWNpcGhlcnRleHQ"
}

func codeOf(t *testing.T, err error) string {
	t.Helper()
	if err == nil {
		return ""
	}
	var pe *Error
	if !errors.As(err, &pe) {
		t.Fatalf("unexpected error type %T: %v", err, err)
	}
	return pe.Code
}

func TestValidateContentRules(t *testing.T) {
	cases := []struct {
		name      string
		encrypted bool
		content   Content
		nAttach   int
		want      string
	}{
		{"plain body in plain channel", false, Content{Body: "hello"}, 0, ""},
		{"attachments only in plain channel", false, Content{}, 1, ""},
		{"empty plain post", false, Content{Body: "  "}, 0, "empty_content"},
		{"ciphertext in plain channel", false, Content{Ciphertext: ptr(validEnvelope())}, 0, "encryption_not_allowed"},
		{"ciphertext with body in plain channel", false, Content{Body: "x", Ciphertext: ptr(validEnvelope())}, 0, "encryption_not_allowed"},
		{"ciphertext in encrypted channel", true, Content{Ciphertext: ptr(validEnvelope())}, 0, ""},
		{"plain body in encrypted channel", true, Content{Body: "leak"}, 0, "encryption_required"},
		{"whitespace body in encrypted channel", true, Content{Body: " ", Ciphertext: ptr(validEnvelope())}, 0, "encryption_required"},
		{"body next to ciphertext", true, Content{Body: "leak", Ciphertext: ptr(validEnvelope())}, 0, "encryption_required"},
		{"nothing in encrypted channel", true, Content{}, 0, "encryption_required"},
		{"attachment in encrypted channel", true, Content{Ciphertext: ptr(validEnvelope())}, 1, "encrypted_attachments_unsupported"},
		{"unknown version", true, Content{Ciphertext: ptr("pe2." + testKeyID + ".AAAAAAAAAAAAAAAA.eA")}, 0, "invalid_ciphertext"},
		{"short iv", true, Content{Ciphertext: ptr("pe1." + testKeyID + ".AAAA.eA")}, 0, "invalid_ciphertext"},
		{"not base64url", true, Content{Ciphertext: ptr("pe1." + testKeyID + ".AAAAAAAAAAAAAAAA.a+b/")}, 0, "invalid_ciphertext"},
		{"empty ciphertext", true, Content{Ciphertext: ptr("")}, 0, "invalid_ciphertext"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			keyID, err := validateContent(tc.encrypted, tc.content, tc.nAttach)
			if got := codeOf(t, err); got != tc.want {
				t.Fatalf("code=%q want %q", got, tc.want)
			}
			if tc.want == "" && tc.encrypted && keyID.String() != testKeyID {
				t.Fatalf("keyID=%s want %s", keyID, testKeyID)
			}
		})
	}
}

func TestFromPostCarriesCiphertextOnlyWhileLive(t *testing.T) {
	now := time.Now()
	row := store.Post{
		ID:             uuid.New(),
		ChannelID:      uuid.New(),
		AuthorID:       uuid.New(),
		Encrypted:      true,
		BodyCiphertext: pgtype.Text{String: validEnvelope(), Valid: true},
		CreatedAt:      now,
		UpdatedAt:      now,
	}
	live := fromPost(row, 0, nil)
	if !live.Encrypted || live.Ciphertext == nil || *live.Ciphertext != validEnvelope() || live.Body != "" {
		t.Fatalf("live encrypted view=%+v", live)
	}

	row.DeletedAt = &now
	deleted := fromPost(row, 0, nil)
	if !deleted.Encrypted || deleted.Ciphertext != nil || !deleted.Deleted {
		t.Fatalf("deleted encrypted view must not carry ciphertext: %+v", deleted)
	}

	plain := fromPost(store.Post{ID: uuid.New(), Body: "hello", CreatedAt: now, UpdatedAt: now}, 0, nil)
	if plain.Encrypted || plain.Ciphertext != nil || plain.Body != "hello" {
		t.Fatalf("plain view=%+v", plain)
	}
}
