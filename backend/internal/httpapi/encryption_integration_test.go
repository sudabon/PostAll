package httpapi_test

import (
	"bytes"
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"

	"github.com/google/uuid"
	"github.com/sudabon/PostAll/backend/internal/api"
)

type keyringFixture struct {
	keyID uuid.UUID
	proof string
}

func randomB64(t *testing.T, n int) string {
	t.Helper()
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		t.Fatal(err)
	}
	return base64.RawURLEncoding.EncodeToString(b)
}

func passphraseWrapJSON(t *testing.T) map[string]any {
	return map[string]any{
		"kdf": "pbkdf2-sha256", "iterations": 600000,
		"salt": randomB64(t, 16), "iv": randomB64(t, 12), "wrapped": randomB64(t, 48),
	}
}

func recoveryWrapJSON(t *testing.T) map[string]any {
	return map[string]any{
		"kdf": "hkdf-sha256", "info": "postall:wrap:recovery",
		"salt": randomB64(t, 16), "iv": randomB64(t, 12), "wrapped": randomB64(t, 48),
	}
}

func keyringRequest(t *testing.T, keyID uuid.UUID, proof string) map[string]any {
	return map[string]any{
		"keyId":          keyID.String(),
		"keyProof":       proof,
		"passphraseWrap": passphraseWrapJSON(t),
		"recoveryWrap":   recoveryWrapJSON(t),
	}
}

func setupKeyring(t *testing.T, h http.Handler, authz string) keyringFixture {
	t.Helper()
	f := keyringFixture{keyID: uuid.New(), proof: randomB64(t, 32)}
	res := doJSON(t, h, http.MethodPost, "/v1/encryption/keyring", authz, keyringRequest(t, f.keyID, f.proof))
	if res.Code != http.StatusCreated {
		t.Fatalf("setup keyring=%d %s", res.Code, res.Body)
	}
	return f
}

func envelope(t *testing.T, keyID uuid.UUID) string {
	return "pe1." + keyID.String() + "." + randomB64(t, 12) + "." + randomB64(t, 272)
}

func decodePost(t *testing.T, raw []byte) api.Post {
	t.Helper()
	var p api.Post
	if err := json.Unmarshal(raw, &p); err != nil {
		t.Fatal(err)
	}
	return p
}

func TestEncryptedChannelsAcceptOnlyCiphertext(t *testing.T) {
	env := newAllowlistEnv(t)
	h := env.server(t, allowedSub)
	authz := env.token(allowedSub)
	ctx := context.Background()

	early := doJSON(t, h, http.MethodPost, "/v1/channels", authz, map[string]any{"name": "secret", "encrypted": true})
	if early.Code != http.StatusConflict {
		t.Fatalf("encrypted channel before keyring=%d %s", early.Code, early.Body)
	}
	assertErrorCode(t, early.Body, "encryption_not_configured")
	missing := doJSON(t, h, http.MethodGet, "/v1/encryption/keyring", authz, nil)
	if missing.Code != http.StatusNotFound {
		t.Fatalf("keyring before setup=%d %s", missing.Code, missing.Body)
	}
	assertErrorCode(t, missing.Body, "encryption_not_configured")

	keyring := setupKeyring(t, h, authz)
	got := doJSON(t, h, http.MethodGet, "/v1/encryption/keyring", authz, nil)
	if got.Code != http.StatusOK {
		t.Fatalf("get keyring=%d %s", got.Code, got.Body)
	}
	var stored api.EncryptionKeyring
	if err := json.Unmarshal(got.Body, &stored); err != nil {
		t.Fatal(err)
	}
	if uuid.UUID(stored.KeyId) != keyring.keyID || stored.PassphraseWrap.Iterations == nil || *stored.PassphraseWrap.Iterations != 600000 {
		t.Fatalf("keyring=%+v", stored)
	}
	if bytes.Contains(got.Body, []byte(keyring.proof)) {
		t.Fatal("keyring response leaks the key proof")
	}

	secret := createChannel(t, h, authz, map[string]any{"name": "secret", "encrypted": true})
	plain := createChannel(t, h, authz, map[string]any{"name": "inbox"})
	child := createChannel(t, h, authz, map[string]any{"name": "child", "parentId": secret.Id.String(), "encrypted": false})
	if !secret.Encrypted || plain.Encrypted || child.Encrypted {
		t.Fatalf("encrypted flags secret=%v plain=%v child=%v", secret.Encrypted, plain.Encrypted, child.Encrypted)
	}

	// リネーム・移動の要求に encrypted を混ぜても、暗号化の有無は変わらない。
	renamed := patchJSON(t, h, "/v1/channels/"+secret.Id.String(), authz, map[string]any{"name": "vault", "encrypted": false})
	moved := postJSON(t, h, "/v1/channels/"+secret.Id.String()+"/move", authz, map[string]any{
		"parentId": plain.Id.String(), "encrypted": false,
	})
	renamedPlain := patchJSON(t, h, "/v1/channels/"+plain.Id.String(), authz, map[string]any{"name": "inbox2", "encrypted": true})
	if !renamed.Encrypted || !moved.Encrypted || renamedPlain.Encrypted {
		t.Fatalf("rename/move changed encryption: %v %v %v", renamed.Encrypted, moved.Encrypted, renamedPlain.Encrypted)
	}

	rootEnvelope := envelope(t, keyring.keyID)
	res := doJSON(t, h, http.MethodPost, "/v1/channels/"+secret.Id.String()+"/posts", authz, map[string]any{"ciphertext": rootEnvelope})
	if res.Code != http.StatusCreated {
		t.Fatalf("encrypted post=%d %s", res.Code, res.Body)
	}
	root := decodePost(t, res.Body)
	if !root.Encrypted || root.Body != "" || root.Ciphertext == nil || *root.Ciphertext != rootEnvelope {
		t.Fatalf("encrypted post response=%+v", root)
	}
	readRow := func(id uuid.UUID) (body string, ciphertext sql.NullString, deleted bool) {
		t.Helper()
		if err := env.pool.QueryRow(ctx, `
			select body, body_ciphertext, deleted_at is not null from posts where id = $1
		`, id).Scan(&body, &ciphertext, &deleted); err != nil {
			t.Fatal(err)
		}
		return body, ciphertext, deleted
	}
	if body, ct, _ := readRow(root.Id); body != "" || ct.String != rootEnvelope {
		t.Fatalf("stored encrypted post body=%q ciphertext=%q", body, ct.String)
	}

	replyEnvelope := envelope(t, keyring.keyID)
	res = doJSON(t, h, http.MethodPost, "/v1/posts/"+root.Id.String()+"/replies", authz, map[string]any{"ciphertext": replyEnvelope})
	if res.Code != http.StatusCreated {
		t.Fatalf("encrypted reply=%d %s", res.Code, res.Body)
	}
	reply := decodePost(t, res.Body)
	if !reply.Encrypted || reply.ThreadRootId == nil || *reply.ThreadRootId != root.Id {
		t.Fatalf("encrypted reply=%+v", reply)
	}

	plainPost := createPost(t, h, authz, plain.Id.String(), "plain memo")
	if plainPost.Encrypted || plainPost.Ciphertext != nil {
		t.Fatalf("plain post=%+v", plainPost)
	}

	attachmentID := uuid.New().String()
	otherKey := envelope(t, uuid.New())
	rejected := []struct {
		name, method, path, code string
		body                     map[string]any
	}{
		{"plain post in encrypted channel", http.MethodPost, "/v1/channels/" + secret.Id.String() + "/posts", "encryption_required", map[string]any{"body": "leak-create"}},
		{"plain body next to ciphertext", http.MethodPost, "/v1/channels/" + secret.Id.String() + "/posts", "encryption_required", map[string]any{"body": "leak-both", "ciphertext": envelope(t, keyring.keyID)}},
		{"plain reply in encrypted thread", http.MethodPost, "/v1/posts/" + root.Id.String() + "/replies", "encryption_required", map[string]any{"body": "leak-reply"}},
		{"plain edit of encrypted post", http.MethodPatch, "/v1/posts/" + root.Id.String(), "encryption_required", map[string]any{"body": "leak-edit"}},
		{"ciphertext in plain channel", http.MethodPost, "/v1/channels/" + plain.Id.String() + "/posts", "encryption_not_allowed", map[string]any{"ciphertext": envelope(t, keyring.keyID)}},
		{"ciphertext reply in plain thread", http.MethodPost, "/v1/posts/" + plainPost.Id.String() + "/replies", "encryption_not_allowed", map[string]any{"ciphertext": envelope(t, keyring.keyID)}},
		{"ciphertext edit of plain post", http.MethodPatch, "/v1/posts/" + plainPost.Id.String(), "encryption_not_allowed", map[string]any{"body": "", "ciphertext": envelope(t, keyring.keyID)}},
		{"attachment on encrypted post", http.MethodPost, "/v1/channels/" + secret.Id.String() + "/posts", "encrypted_attachments_unsupported", map[string]any{"ciphertext": envelope(t, keyring.keyID), "attachmentIds": []string{attachmentID}}},
		{"attachment on encrypted reply", http.MethodPost, "/v1/posts/" + root.Id.String() + "/replies", "encrypted_attachments_unsupported", map[string]any{"ciphertext": envelope(t, keyring.keyID), "attachmentIds": []string{attachmentID}}},
		{"attachment on encrypted edit", http.MethodPatch, "/v1/posts/" + root.Id.String(), "encrypted_attachments_unsupported", map[string]any{"body": "", "ciphertext": envelope(t, keyring.keyID), "attachmentIds": []string{attachmentID}}},
		{"ciphertext of another key", http.MethodPost, "/v1/channels/" + secret.Id.String() + "/posts", "invalid_ciphertext", map[string]any{"ciphertext": otherKey}},
		{"malformed ciphertext", http.MethodPost, "/v1/channels/" + secret.Id.String() + "/posts", "invalid_ciphertext", map[string]any{"ciphertext": "pe1.garbage"}},
	}
	var before int
	if err := env.pool.QueryRow(ctx, `select count(*) from posts`).Scan(&before); err != nil {
		t.Fatal(err)
	}
	for _, tc := range rejected {
		res := doJSON(t, h, tc.method, tc.path, authz, tc.body)
		if res.Code != http.StatusBadRequest {
			t.Fatalf("%s=%d %s", tc.name, res.Code, res.Body)
		}
		assertErrorCode(t, res.Body, tc.code)
	}
	var after, leaked int
	if err := env.pool.QueryRow(ctx, `select count(*) from posts`).Scan(&after); err != nil {
		t.Fatal(err)
	}
	if err := env.pool.QueryRow(ctx, `select count(*) from posts where body like 'leak%'`).Scan(&leaked); err != nil {
		t.Fatal(err)
	}
	if after != before || leaked != 0 {
		t.Fatalf("rejected requests wrote posts: before=%d after=%d leaked=%d", before, after, leaked)
	}
	if body, ct, _ := readRow(root.Id); body != "" || ct.String != rootEnvelope {
		t.Fatalf("rejected edit changed the encrypted post: body=%q", body)
	}
	if body, ct, _ := readRow(plainPost.Id); body != "plain memo" || ct.Valid {
		t.Fatalf("rejected edit changed the plain post: body=%q ciphertext=%v", body, ct.Valid)
	}

	editedEnvelope := envelope(t, keyring.keyID)
	res = doJSON(t, h, http.MethodPatch, "/v1/posts/"+root.Id.String(), authz, map[string]any{"body": "", "ciphertext": editedEnvelope})
	if res.Code != http.StatusOK {
		t.Fatalf("encrypted edit=%d %s", res.Code, res.Body)
	}
	if edited := decodePost(t, res.Body); edited.Ciphertext == nil || *edited.Ciphertext != editedEnvelope || edited.EditedAt == nil {
		t.Fatalf("encrypted edit response=%+v", edited)
	}

	thread := getThread(t, h, authz, root.Id.String())
	if thread.Root.Ciphertext == nil || *thread.Root.Ciphertext != editedEnvelope || len(thread.Replies) != 1 || *thread.Replies[0].Ciphertext != replyEnvelope {
		t.Fatalf("thread=%+v", thread)
	}
	timeline := listPosts(t, h, authz, secret.Id.String(), "")
	if len(timeline.Posts) != 1 || !timeline.Posts[0].Encrypted || timeline.Posts[0].ReplyCount != 1 {
		t.Fatalf("timeline=%+v", timeline.Posts)
	}

	// 論理削除で暗号文も消える。削除済みであることとスレッドの参照は残る。
	if res := doJSON(t, h, http.MethodDelete, "/v1/posts/"+root.Id.String(), authz, nil); res.Code != http.StatusNoContent {
		t.Fatalf("delete encrypted root=%d %s", res.Code, res.Body)
	}
	if body, ct, deleted := readRow(root.Id); body != "" || ct.Valid || !deleted {
		t.Fatalf("deleted encrypted row body=%q ciphertext=%v deleted=%v", body, ct.Valid, deleted)
	}
	var threadRootID uuid.UUID
	if err := env.pool.QueryRow(ctx, `select thread_root_id from posts where id = $1`, reply.Id).Scan(&threadRootID); err != nil {
		t.Fatal(err)
	}
	if threadRootID != root.Id {
		t.Fatalf("reply lost its thread root: %s", threadRootID)
	}
	placeholder := getThread(t, h, authz, reply.Id.String())
	if !placeholder.Root.Deleted || placeholder.Root.Ciphertext != nil || len(placeholder.Replies) != 1 {
		t.Fatalf("placeholder=%+v", placeholder)
	}
}

func TestEncryptionKeyringSetupAcceptsOnlyOneDevice(t *testing.T) {
	env := newAllowlistEnv(t)
	h := env.server(t, allowedSub)
	authz := env.token(allowedSub)

	const devices = 8
	codes := make([]int, devices)
	bodies := make([][]byte, devices)
	reqs := make([]map[string]any, devices)
	for i := range reqs {
		reqs[i] = keyringRequest(t, uuid.New(), randomB64(t, 32))
	}
	var wg sync.WaitGroup
	start := make(chan struct{})
	for i := range devices {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			var buf bytes.Buffer
			_ = json.NewEncoder(&buf).Encode(reqs[i])
			req := httptest.NewRequest(http.MethodPost, "/v1/encryption/keyring", &buf)
			req.Header.Set("Authorization", authz)
			req.Header.Set("Content-Type", "application/json")
			rec := httptest.NewRecorder()
			h.ServeHTTP(rec, req)
			codes[i], bodies[i] = rec.Code, rec.Body.Bytes()
		}()
	}
	close(start)
	wg.Wait()

	created := 0
	for i, code := range codes {
		switch code {
		case http.StatusCreated:
			created++
		case http.StatusConflict:
			assertErrorCode(t, bodies[i], "encryption_already_configured")
		default:
			t.Fatalf("device %d status=%d %s", i, code, bodies[i])
		}
	}
	var rows int
	if err := env.pool.QueryRow(context.Background(), `select count(*) from encryption_keyring`).Scan(&rows); err != nil {
		t.Fatal(err)
	}
	if created != 1 || rows != 1 {
		t.Fatalf("created=%d rows=%d, want exactly one", created, rows)
	}
}

func TestEncryptionKeyWrapReplacementRequiresKeyProof(t *testing.T) {
	env := newAllowlistEnv(t)
	h := env.server(t, allowedSub)
	authz := env.token(allowedSub)
	keyring := setupKeyring(t, h, authz)

	put := func(kind, proof string, body map[string]any) httpResult {
		t.Helper()
		var buf bytes.Buffer
		_ = json.NewEncoder(&buf).Encode(body)
		req := httptest.NewRequest(http.MethodPut, "/v1/encryption/keyring/"+kind, &buf)
		req.Header.Set("Authorization", authz)
		req.Header.Set("Content-Type", "application/json")
		if proof != "" {
			req.Header.Set("X-Postall-Key-Proof", proof)
		}
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		return httpResult{Code: rec.Code, Body: rec.Body.Bytes()}
	}
	stored := func() []byte {
		t.Helper()
		var passphrase, recovery []byte
		if err := env.pool.QueryRow(context.Background(), `
			select passphrase_wrap::text::bytea, recovery_wrap::text::bytea from encryption_keyring
		`).Scan(&passphrase, &recovery); err != nil {
			t.Fatal(err)
		}
		return append(passphrase, recovery...)
	}
	original := stored()

	for _, kind := range []string{"passphrase", "recovery"} {
		wrap := passphraseWrapJSON(t)
		if kind == "recovery" {
			wrap = recoveryWrapJSON(t)
		}
		for _, proof := range []string{randomB64(t, 32), "not-a-proof"} {
			res := put(kind, proof, wrap)
			if res.Code != http.StatusForbidden {
				t.Fatalf("%s with wrong proof=%d %s", kind, res.Code, res.Body)
			}
			assertErrorCode(t, res.Body, "key_proof_mismatch")
		}
		if res := put(kind, "", wrap); res.Code != http.StatusBadRequest {
			t.Fatalf("%s without proof=%d %s", kind, res.Code, res.Body)
		}
	}
	if !bytes.Equal(stored(), original) {
		t.Fatal("keyring changed after rejected replacements")
	}

	weak := passphraseWrapJSON(t)
	weak["iterations"] = 1000
	if res := put("passphrase", keyring.proof, weak); res.Code != http.StatusBadRequest {
		t.Fatalf("weak passphrase wrap=%d %s", res.Code, res.Body)
	}
	if res := put("master", keyring.proof, passphraseWrapJSON(t)); res.Code != http.StatusBadRequest {
		t.Fatalf("unknown kind=%d %s", res.Code, res.Body)
	}

	next := passphraseWrapJSON(t)
	res := put("passphrase", keyring.proof, next)
	if res.Code != http.StatusOK {
		t.Fatalf("replace passphrase=%d %s", res.Code, res.Body)
	}
	var updated api.EncryptionKeyring
	if err := json.Unmarshal(res.Body, &updated); err != nil {
		t.Fatal(err)
	}
	if updated.PassphraseWrap.Wrapped != next["wrapped"] || uuid.UUID(updated.KeyId) != keyring.keyID {
		t.Fatalf("updated keyring=%+v", updated)
	}
	if res := put("recovery", keyring.proof, recoveryWrapJSON(t)); res.Code != http.StatusOK {
		t.Fatalf("replace recovery=%d %s", res.Code, res.Body)
	}
}
