package httpapi

import (
	"net/http"

	"github.com/google/uuid"
	"github.com/sudabon/PostAll/backend/internal/api"
	"github.com/sudabon/PostAll/backend/internal/encryption"
)

func (s *Server) GetEncryptionKeyring(w http.ResponseWriter, r *http.Request) {
	if !s.requireKeyring(w) {
		return
	}
	keyring, err := s.keyring.Get(r.Context())
	if err != nil {
		writeAppError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, toAPIKeyring(keyring))
}

func (s *Server) CreateEncryptionKeyring(w http.ResponseWriter, r *http.Request) {
	if !s.requireKeyring(w) {
		return
	}
	var body api.CreateEncryptionKeyringJSONRequestBody
	if !decodeJSON(w, r, &body) {
		return
	}
	keyring, err := s.keyring.Create(
		r.Context(),
		uuid.UUID(body.KeyId),
		body.KeyProof,
		fromAPIWrap(body.PassphraseWrap),
		fromAPIWrap(body.RecoveryWrap),
	)
	if err != nil {
		writeAppError(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, toAPIKeyring(keyring))
}

func (s *Server) ReplaceEncryptionKeyWrap(w http.ResponseWriter, r *http.Request, kind api.KeyWrapKind, params api.ReplaceEncryptionKeyWrapParams) {
	if !s.requireKeyring(w) {
		return
	}
	var body api.ReplaceEncryptionKeyWrapJSONRequestBody
	if !decodeJSON(w, r, &body) {
		return
	}
	keyring, err := s.keyring.ReplaceWrap(r.Context(), string(kind), params.XPostallKeyProof, fromAPIWrap(body))
	if err != nil {
		writeAppError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, toAPIKeyring(keyring))
}

func (s *Server) requireKeyring(w http.ResponseWriter) bool {
	if s.keyring != nil {
		return true
	}
	writeAPIError(w, http.StatusServiceUnavailable, "unavailable", "データベースに接続できません", nil)
	return false
}

func fromAPIWrap(w api.KeyWrap) encryption.Wrap {
	return encryption.Wrap{
		Kdf:        string(w.Kdf),
		Iterations: w.Iterations,
		Salt:       w.Salt,
		Info:       w.Info,
		Iv:         w.Iv,
		Wrapped:    w.Wrapped,
	}
}

func toAPIWrap(w encryption.Wrap) api.KeyWrap {
	return api.KeyWrap{
		Kdf:        api.KeyWrapKdf(w.Kdf),
		Iterations: w.Iterations,
		Salt:       w.Salt,
		Info:       w.Info,
		Iv:         w.Iv,
		Wrapped:    w.Wrapped,
	}
}

func toAPIKeyring(k encryption.Keyring) api.EncryptionKeyring {
	return api.EncryptionKeyring{
		KeyId:          k.KeyID,
		PassphraseWrap: toAPIWrap(k.PassphraseWrap),
		RecoveryWrap:   toAPIWrap(k.RecoveryWrap),
		CreatedAt:      k.CreatedAt,
		UpdatedAt:      k.UpdatedAt,
	}
}
