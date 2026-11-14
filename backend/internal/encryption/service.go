package encryption

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/sudabon/PostAll/backend/internal/store"
)

const (
	KindPassphrase = "passphrase"
	KindRecovery   = "recovery"

	kdfPBKDF2 = "pbkdf2-sha256"
	kdfHKDF   = "hkdf-sha256"

	minPBKDF2Iterations = 600_000
	maxPBKDF2Iterations = 10_000_000
	keyProofBytes       = 32
	minSaltBytes        = 16
	ivBytes             = 12
	// 32 バイトのマスター鍵と 16 バイトの認証タグ。
	wrappedBytes = 48
	maxInfoChars = 128
)

// Wrap は、マスター鍵をパスフレーズまたは復旧キーから導いた鍵で包んだもの。
// サーバーは中身を解かずに保存する。
type Wrap struct {
	Kdf        string  `json:"kdf"`
	Iterations *int    `json:"iterations,omitempty"`
	Salt       string  `json:"salt"`
	Info       *string `json:"info,omitempty"`
	Iv         string  `json:"iv"`
	Wrapped    string  `json:"wrapped"`
}

type Keyring struct {
	KeyID          uuid.UUID
	PassphraseWrap Wrap
	RecoveryWrap   Wrap
	CreatedAt      time.Time
	UpdatedAt      time.Time
}

type Service struct {
	q *store.Queries
}

func NewService(q *store.Queries) *Service {
	return &Service{q: q}
}

func (s *Service) Get(ctx context.Context) (Keyring, error) {
	row, err := s.q.GetEncryptionKeyring(ctx)
	if errors.Is(err, pgx.ErrNoRows) {
		return Keyring{}, errNotConfigured()
	}
	if err != nil {
		return Keyring{}, err
	}
	return fromRow(row)
}

// Create は初期設定の鍵束を登録する。既にあれば置き換えずに 409 を返す。
func (s *Service) Create(ctx context.Context, keyID uuid.UUID, keyProof string, passphrase, recovery Wrap) (Keyring, error) {
	if keyID == uuid.Nil {
		return Keyring{}, errValidation("keyId が不正です")
	}
	proof, err := decodeProof(keyProof)
	if err != nil {
		return Keyring{}, err
	}
	passphraseJSON, err := encodeWrap(KindPassphrase, passphrase)
	if err != nil {
		return Keyring{}, err
	}
	recoveryJSON, err := encodeWrap(KindRecovery, recovery)
	if err != nil {
		return Keyring{}, err
	}
	hash := sha256.Sum256(proof)
	row, err := s.q.InsertEncryptionKeyring(ctx, store.InsertEncryptionKeyringParams{
		KeyID:          keyID,
		AuthHash:       hash[:],
		PassphraseWrap: string(passphraseJSON),
		RecoveryWrap:   string(recoveryJSON),
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return Keyring{}, errAlreadyConfigured()
	}
	if err != nil {
		return Keyring{}, err
	}
	return fromRow(row)
}

// ReplaceWrap は、マスター鍵の所持を確かめてから、指定した種類の包みだけを置き換える。
func (s *Service) ReplaceWrap(ctx context.Context, kind, keyProof string, wrap Wrap) (Keyring, error) {
	if kind != KindPassphrase && kind != KindRecovery {
		return Keyring{}, errValidation("包みの種類が不正です")
	}
	encoded, err := encodeWrap(kind, wrap)
	if err != nil {
		return Keyring{}, err
	}
	row, err := s.q.GetEncryptionKeyring(ctx)
	if errors.Is(err, pgx.ErrNoRows) {
		return Keyring{}, errNotConfigured()
	}
	if err != nil {
		return Keyring{}, err
	}
	proof, err := decodeProof(keyProof)
	if err != nil {
		return Keyring{}, errKeyProofMismatch()
	}
	hash := sha256.Sum256(proof)
	if subtle.ConstantTimeCompare(hash[:], row.AuthHash) != 1 {
		return Keyring{}, errKeyProofMismatch()
	}
	if kind == KindPassphrase {
		row, err = s.q.UpdatePassphraseWrap(ctx, store.UpdatePassphraseWrapParams{Wrap: string(encoded), KeyID: row.KeyID})
	} else {
		row, err = s.q.UpdateRecoveryWrap(ctx, store.UpdateRecoveryWrapParams{Wrap: string(encoded), KeyID: row.KeyID})
	}
	if err != nil {
		return Keyring{}, err
	}
	return fromRow(row)
}

func fromRow(row store.EncryptionKeyring) (Keyring, error) {
	var passphrase, recovery Wrap
	if err := json.Unmarshal(row.PassphraseWrap, &passphrase); err != nil {
		return Keyring{}, err
	}
	if err := json.Unmarshal(row.RecoveryWrap, &recovery); err != nil {
		return Keyring{}, err
	}
	return Keyring{
		KeyID:          row.KeyID,
		PassphraseWrap: passphrase,
		RecoveryWrap:   recovery,
		CreatedAt:      row.CreatedAt,
		UpdatedAt:      row.UpdatedAt,
	}, nil
}

func decodeProof(raw string) ([]byte, error) {
	proof, err := base64.RawURLEncoding.DecodeString(raw)
	if err != nil || len(proof) != keyProofBytes {
		return nil, errValidation("keyProof が不正です")
	}
	return proof, nil
}

// encodeWrap は包みの形を検証して JSON にする。弱いパラメータや壊れた値で鍵束を上書きさせない。
func encodeWrap(kind string, w Wrap) ([]byte, error) {
	switch kind {
	case KindPassphrase:
		if w.Kdf != kdfPBKDF2 || w.Iterations == nil || w.Info != nil {
			return nil, errValidation("パスフレーズの包みは pbkdf2-sha256 で反復回数を指定してください")
		}
		if *w.Iterations < minPBKDF2Iterations || *w.Iterations > maxPBKDF2Iterations {
			return nil, errValidation("反復回数が範囲外です")
		}
	case KindRecovery:
		if w.Kdf != kdfHKDF || w.Iterations != nil || w.Info == nil {
			return nil, errValidation("復旧キーの包みは hkdf-sha256 で info を指定してください")
		}
		if *w.Info == "" || len([]rune(*w.Info)) > maxInfoChars {
			return nil, errValidation("info が不正です")
		}
	default:
		return nil, errValidation("包みの種類が不正です")
	}
	if n, ok := decodedLen(w.Salt); !ok || n < minSaltBytes {
		return nil, errValidation("salt が不正です")
	}
	if n, ok := decodedLen(w.Iv); !ok || n != ivBytes {
		return nil, errValidation("iv が不正です")
	}
	if n, ok := decodedLen(w.Wrapped); !ok || n != wrappedBytes {
		return nil, errValidation("wrapped が不正です")
	}
	return json.Marshal(w)
}

func decodedLen(s string) (int, bool) {
	b, err := base64.RawURLEncoding.DecodeString(s)
	if err != nil {
		return 0, false
	}
	return len(b), true
}
