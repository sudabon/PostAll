package httpapi

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"time"

	"github.com/sudabon/PostAll/backend/internal/api"
	"github.com/sudabon/PostAll/backend/internal/attachment"
	"github.com/sudabon/PostAll/backend/internal/auth"
	"github.com/sudabon/PostAll/backend/internal/blob"
	changeservice "github.com/sudabon/PostAll/backend/internal/change"
	"github.com/sudabon/PostAll/backend/internal/channel"
	"github.com/sudabon/PostAll/backend/internal/emoji"
	"github.com/sudabon/PostAll/backend/internal/post"
	searchservice "github.com/sudabon/PostAll/backend/internal/search"
	"github.com/sudabon/PostAll/backend/internal/store"

	"github.com/jackc/pgx/v5/pgxpool"
)

type Config struct {
	DatabaseURL       string
	AWSRegion         string
	CognitoUserPoolID string
	CognitoClientID   string
	Verifier          *auth.Verifier
	S3Bucket          string
	Blob              blob.Store
	EmojiDir          string
	ReaperInterval    time.Duration
}

type Server struct {
	pool        *pgxpool.Pool
	channels    *channel.Service
	posts       *post.Service
	search      *searchservice.Service
	changes     *changeservice.Service
	emojis      *emoji.Service
	emojiDir    string
	attachments *attachment.Service
	events      *eventBroker
	stopReap    context.CancelFunc
	mux         http.Handler
}

func New(cfg Config) (http.Handler, error) {
	emojiDir := cfg.EmojiDir
	if emojiDir == "" {
		emojiDir = "../emoji"
	}
	s := &Server{emojiDir: emojiDir}

	var users auth.UserStore
	if cfg.DatabaseURL != "" {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		pool, err := pgxpool.New(ctx, cfg.DatabaseURL)
		if err != nil {
			return nil, err
		}
		s.pool = pool
		st := store.NewStore(pool)
		users = st
		blobStore := cfg.Blob
		if blobStore == nil && cfg.S3Bucket != "" {
			s3, err := blob.NewS3(ctx, cfg.AWSRegion, cfg.S3Bucket)
			if err != nil {
				pool.Close()
				return nil, err
			}
			blobStore = s3
		}
		s.attachments = attachment.NewService(st.Queries, blobStore)
		s.events = newEventBroker(pool)
		s.channels = channel.NewService(st.Queries)
		s.posts = post.NewService(st.Queries, st.Pool, s.attachments)
		s.search = searchservice.NewService(st.Queries)
		s.changes = changeservice.NewService(st.Queries)
		s.emojis = emoji.NewService(st.Queries)
		if cfg.ReaperInterval > 0 && s.attachments.Ready() {
			reapCtx, cancel := context.WithCancel(context.Background())
			s.stopReap = cancel
			go s.reapLoop(reapCtx, cfg.ReaperInterval)
		}
	}

	v := cfg.Verifier
	if v == nil && cfg.AWSRegion != "" && cfg.CognitoUserPoolID != "" && cfg.CognitoClientID != "" {
		v = auth.NewVerifier(cfg.AWSRegion, cfg.CognitoUserPoolID, cfg.CognitoClientID, nil)
	}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /ready", s.GetHealth)
	inner := api.HandlerWithOptions(s, api.StdHTTPServerOptions{
		BaseRouter: mux,
		ErrorHandlerFunc: func(w http.ResponseWriter, r *http.Request, err error) {
			writeAPIError(w, http.StatusBadRequest, "validation", "リクエストが不正です", nil)
		},
	})
	s.mux = requestIDMiddleware(auth.Middleware(v, users)(inner))
	return s, nil
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	s.mux.ServeHTTP(w, r)
}

func (s *Server) GetHealth(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
	defer cancel()

	resp := api.Health{Status: api.HealthStatusOk, Database: api.HealthDatabaseSkipped}
	if s.pool != nil {
		if err := s.pool.Ping(ctx); err != nil {
			writeJSON(w, http.StatusServiceUnavailable, api.Health{
				Status:   api.HealthStatusUnhealthy,
				Database: api.HealthDatabaseUnreachable,
			})
			return
		}
		resp.Database = api.HealthDatabaseOk
	}
	writeJSON(w, http.StatusOK, resp)
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

func (s *Server) Close() {
	if s.stopReap != nil {
		s.stopReap()
	}
	if s.events != nil {
		s.events.Close()
	}
	if s.pool != nil {
		s.pool.Close()
	}
}

func (s *Server) reapLoop(ctx context.Context, interval time.Duration) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if err := s.attachments.Reap(ctx); err != nil {
				slog.ErrorContext(ctx, "attachment reaper failed", "error", safeLogError(err))
			}
		}
	}
}
