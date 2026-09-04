package httpapi_test

import (
	"bytes"
	"context"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/sudabon/PostAll/backend/internal/auth"
	"github.com/sudabon/PostAll/backend/internal/blob"
	"github.com/sudabon/PostAll/backend/internal/emoji"
	"github.com/sudabon/PostAll/backend/internal/httpapi"
	"github.com/sudabon/PostAll/backend/internal/testutil"
)

// シグネチャだけが本物の最小のバイト列。サーバは画像をデコードせず、先頭の
// シグネチャで形式を判定するので、境界のテストはこれで足りる。
var (
	uploadPNG = []byte("\x89PNG\r\n\x1a\nstamp-upload")
	uploadGIF = []byte("GIF89astamp-upload")
)

type uploadPart struct {
	shortcode       string
	filename        string
	partContentType string
	image           []byte
	omitFile        bool
	omitShortcode   bool
}

func doUpload(t *testing.T, h http.Handler, authz string, part uploadPart) httpResult {
	t.Helper()
	var buf bytes.Buffer
	form := multipart.NewWriter(&buf)
	if !part.omitShortcode {
		if err := form.WriteField("shortcode", part.shortcode); err != nil {
			t.Fatal(err)
		}
	}
	if !part.omitFile {
		filename := part.filename
		if filename == "" {
			filename = "stamp.png"
		}
		header := make(map[string][]string)
		header["Content-Disposition"] = []string{
			`form-data; name="file"; filename="` + filename + `"`,
		}
		if part.partContentType != "" {
			header["Content-Type"] = []string{part.partContentType}
		}
		w, err := form.CreatePart(header)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := w.Write(part.image); err != nil {
			t.Fatal(err)
		}
	}
	if err := form.Close(); err != nil {
		t.Fatal(err)
	}

	req := httptest.NewRequest(http.MethodPost, "/v1/emojis", &buf)
	if authz != "" {
		req.Header.Set("Authorization", authz)
	}
	req.Header.Set("Content-Type", form.FormDataContentType())
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return httpResult{Code: rec.Code, Body: rec.Body.Bytes()}
}

func decodeEmoji(t *testing.T, raw []byte) emojiJSON {
	t.Helper()
	var out emojiJSON
	if err := json.Unmarshal(raw, &out); err != nil {
		t.Fatalf("decode emoji: %v %s", err, raw)
	}
	return out
}

func getImage(t *testing.T, h http.Handler, authz, shortcode string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "/v1/emojis/"+shortcode+"/image", nil)
	req.Header.Set("Authorization", authz)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func newUploadServer(t *testing.T, objects blob.Store) (http.Handler, string, string) {
	t.Helper()
	databaseURL := testutil.PostgresURL(t)
	key, jwks, kid := testRSA(t)
	jwksServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write(jwks)
	}))
	t.Cleanup(jwksServer.Close)

	verifier := auth.NewVerifierFromURL(jwksServer.URL, "https://issuer.example", "authenticated", jwksServer.Client())
	h, err := httpapi.New(httpapi.Config{DatabaseURL: databaseURL, Verifier: verifier, EmojiBlob: objects})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(h.Close)
	return h, "Bearer " + mint(t, key, kid, "upload-user"), databaseURL
}

func TestCreateEmojiAcceptsPNGAndGIF(t *testing.T) {
	mem := blob.NewMemory()
	h, authz, databaseURL := newUploadServer(t, mem)

	created := doUpload(t, h, authz, uploadPart{shortcode: "uploaded-png", image: uploadPNG})
	if created.Code != http.StatusCreated {
		t.Fatalf("png upload = %d %s", created.Code, created.Body)
	}
	item := decodeEmoji(t, created.Body)
	if item.Shortcode != "uploaded-png" {
		t.Errorf("shortcode = %q", item.Shortcode)
	}
	if item.ID == "" || item.Checksum == "" {
		t.Errorf("id / checksum が空: %+v", item)
	}
	if item.ImagePath != "/v1/emojis/uploaded-png/image" {
		t.Errorf("imagePath = %q", item.ImagePath)
	}

	// 登録した実体がそのまま配信され、形式が Content-Type で示される。
	image := getImage(t, h, authz, "uploaded-png")
	if image.Code != http.StatusOK {
		t.Fatalf("get image = %d %s", image.Code, image.Body)
	}
	if got := image.Header().Get("Content-Type"); got != "image/png" {
		t.Errorf("content-type = %q, want image/png", got)
	}
	if got := image.Body.String(); got != string(uploadPNG) {
		t.Errorf("配信された内容がアップロードしたものと違う: %q", got)
	}

	gifCreated := doUpload(t, h, authz, uploadPart{shortcode: "uploaded-gif", filename: "stamp.gif", image: uploadGIF})
	if gifCreated.Code != http.StatusCreated {
		t.Fatalf("gif upload = %d %s", gifCreated.Code, gifCreated.Body)
	}
	gifImage := getImage(t, h, authz, "uploaded-gif")
	if got := gifImage.Header().Get("Content-Type"); got != "image/gif" {
		t.Errorf("gif content-type = %q, want image/gif", got)
	}
	if got := gifImage.Body.String(); got != string(uploadGIF) {
		t.Errorf("gif の内容が違う: %q", got)
	}

	// 一覧に両方現れる。
	list := doJSON(t, h, http.MethodGet, "/v1/emojis", authz, nil)
	if list.Code != http.StatusOK {
		t.Fatalf("list = %d %s", list.Code, list.Body)
	}
	var listed struct {
		Emojis []emojiJSON `json:"emojis"`
	}
	if err := json.Unmarshal(list.Body, &listed); err != nil {
		t.Fatal(err)
	}
	found := map[string]bool{}
	for _, e := range listed.Emojis {
		found[e.Shortcode] = true
	}
	if !found["uploaded-png"] || !found["uploaded-gif"] {
		t.Fatalf("catalog = %+v", listed.Emojis)
	}

	// 保存キーは要求経路の接頭辞配下で、一括登録のファイル名キーと混ざらない。
	pool, err := pgxpool.New(context.Background(), databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	var storageKey string
	if err := pool.QueryRow(context.Background(),
		`select storage_key from emojis where shortcode = 'uploaded-png'`).Scan(&storageKey); err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(storageKey, "emojis/") || !strings.HasSuffix(storageKey, ".png") {
		t.Errorf("storage key = %q, want emojis/<uuid>.png", storageKey)
	}
}

func TestCreateEmojiRejectsInvalidRequests(t *testing.T) {
	mem := blob.NewMemory()
	h, authz, _ := newUploadServer(t, mem)

	atLimit := make([]byte, emoji.MaxImageBytes)
	copy(atLimit, uploadPNG)
	overLimit := make([]byte, emoji.MaxImageBytes+1)
	copy(overLimit, uploadPNG)
	// MaxBytesReader が読み取り段階で落とす大きさ。
	farOverLimit := make([]byte, emoji.MaxImageBytes+128*1024)
	copy(farOverLimit, uploadPNG)

	cases := []struct {
		name     string
		part     uploadPart
		wantCode int
		wantErr  string
	}{
		{
			name:     "PNG でも GIF でもない",
			part:     uploadPart{shortcode: "not-an-image", image: []byte("これは画像ではありません")},
			wantCode: http.StatusBadRequest,
			wantErr:  "unsupported_image",
		},
		{
			name: "拡張子と Content-Type を偽った本文",
			part: uploadPart{
				shortcode:       "forged",
				filename:        "forged.png",
				partContentType: "image/png",
				image:           []byte("plain text pretending to be a png"),
			},
			wantCode: http.StatusBadRequest,
			wantErr:  "unsupported_image",
		},
		{
			name:     "上限値+1",
			part:     uploadPart{shortcode: "over-limit", image: overLimit},
			wantCode: http.StatusRequestEntityTooLarge,
			wantErr:  "image_too_large",
		},
		{
			name:     "本文の読み取り段階で上限超過",
			part:     uploadPart{shortcode: "far-over-limit", image: farOverLimit},
			wantCode: http.StatusRequestEntityTooLarge,
			wantErr:  "image_too_large",
		},
		{
			name:     "ショートコードが不正",
			part:     uploadPart{shortcode: "-bad name", image: uploadPNG},
			wantCode: http.StatusBadRequest,
			wantErr:  "invalid_shortcode",
		},
		{
			name:     "ショートコードのパートが無い",
			part:     uploadPart{omitShortcode: true, image: uploadPNG},
			wantCode: http.StatusBadRequest,
			wantErr:  "invalid_shortcode",
		},
		{
			name:     "ファイルのパートが無い",
			part:     uploadPart{shortcode: "no-file", omitFile: true},
			wantCode: http.StatusBadRequest,
			wantErr:  "image_required",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := doUpload(t, h, authz, tc.part)
			if got.Code != tc.wantCode {
				t.Fatalf("code = %d %s, want %d", got.Code, got.Body, tc.wantCode)
			}
			assertErrorCode(t, got.Body, tc.wantErr)
		})
	}

	// 上限値ちょうどは受理される。
	atLimitResult := doUpload(t, h, authz, uploadPart{shortcode: "at-limit", image: atLimit})
	if atLimitResult.Code != http.StatusCreated {
		t.Fatalf("上限値ちょうど = %d %s", atLimitResult.Code, atLimitResult.Body)
	}

	// 拒否された要求はカタログを変えない。at-limit の 1 件だけが残る。
	list := doJSON(t, h, http.MethodGet, "/v1/emojis", authz, nil)
	var listed struct {
		Emojis []emojiJSON `json:"emojis"`
	}
	if err := json.Unmarshal(list.Body, &listed); err != nil {
		t.Fatal(err)
	}
	if len(listed.Emojis) != 1 || listed.Emojis[0].Shortcode != "at-limit" {
		t.Fatalf("catalog = %+v, want at-limit の 1 件のみ", listed.Emojis)
	}
}

func TestCreateEmojiRequiresAuthorization(t *testing.T) {
	mem := blob.NewMemory()
	h, authz, _ := newUploadServer(t, mem)

	unauthorized := doUpload(t, h, "", uploadPart{shortcode: "sneaky", image: uploadPNG})
	if unauthorized.Code != http.StatusUnauthorized {
		t.Fatalf("unauthorized upload = %d %s", unauthorized.Code, unauthorized.Body)
	}
	if len(mem.Keys()) != 0 {
		t.Fatalf("認可されていない要求で実体が置かれた: %v", mem.Keys())
	}
	list := doJSON(t, h, http.MethodGet, "/v1/emojis", authz, nil)
	if !bytes.Contains(list.Body, []byte(`"emojis":[]`)) {
		t.Fatalf("catalog = %s, want 空", list.Body)
	}
}

func TestCreateEmojiRejectsDuplicateShortcode(t *testing.T) {
	mem := blob.NewMemory()
	h, authz, _ := newUploadServer(t, mem)

	first := doUpload(t, h, authz, uploadPart{shortcode: "shipit", image: uploadPNG})
	if first.Code != http.StatusCreated {
		t.Fatalf("first upload = %d %s", first.Code, first.Body)
	}
	original := decodeEmoji(t, first.Body)

	conflict := doUpload(t, h, authz, uploadPart{shortcode: "shipit", filename: "shipit.gif", image: uploadGIF})
	if conflict.Code != http.StatusConflict {
		t.Fatalf("duplicate upload = %d %s", conflict.Code, conflict.Body)
	}
	assertErrorCode(t, conflict.Body, "shortcode_conflict")

	// 既存のスタンプは画像もチェックサムも差し替わらない。
	image := getImage(t, h, authz, "shipit")
	if image.Code != http.StatusOK {
		t.Fatalf("get image = %d", image.Code)
	}
	if got := image.Body.String(); got != string(uploadPNG) {
		t.Errorf("既存の画像が差し替わった: %q", got)
	}
	if got := image.Header().Get("Content-Type"); got != "image/png" {
		t.Errorf("既存の形式が変わった: %q", got)
	}
	list := doJSON(t, h, http.MethodGet, "/v1/emojis", authz, nil)
	var listed struct {
		Emojis []emojiJSON `json:"emojis"`
	}
	if err := json.Unmarshal(list.Body, &listed); err != nil {
		t.Fatal(err)
	}
	if len(listed.Emojis) != 1 {
		t.Fatalf("catalog = %+v, want 1 件", listed.Emojis)
	}
	if listed.Emojis[0].ID != original.ID || listed.Emojis[0].Checksum != original.Checksum {
		t.Fatalf("既存行が変わった: before=%+v after=%+v", original, listed.Emojis[0])
	}
}

func TestCreateEmojiWithoutStorageIsUnavailable(t *testing.T) {
	h, authz, _ := newUploadServer(t, nil)

	got := doUpload(t, h, authz, uploadPart{shortcode: "no-storage", image: uploadPNG})
	if got.Code != http.StatusServiceUnavailable {
		t.Fatalf("code = %d %s, want %d", got.Code, got.Body, http.StatusServiceUnavailable)
	}
	assertErrorCode(t, got.Body, "unavailable")
}
