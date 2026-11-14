package encryption

import (
	"regexp"

	"github.com/google/uuid"
)

// MaxCiphertextBytes は 1 件の暗号文の上限。サーバーは中身を解かないので、形式と長さだけを見る。
const MaxCiphertextBytes = 256 << 10

// pe1.<keyId>.<iv>.<ciphertext>。iv は 12 バイトの base64url（16 文字）。
var envelopePattern = regexp.MustCompile(
	`^pe1\.([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]+$`,
)

// EnvelopeKeyID は、暗号文の形式が正しければ埋め込まれた鍵 ID を返す。
func EnvelopeKeyID(envelope string) (uuid.UUID, bool) {
	if len(envelope) > MaxCiphertextBytes {
		return uuid.Nil, false
	}
	m := envelopePattern.FindStringSubmatch(envelope)
	if m == nil {
		return uuid.Nil, false
	}
	id, err := uuid.Parse(m[1])
	if err != nil {
		return uuid.Nil, false
	}
	return id, true
}
