package httpapi

import (
	"context"
	"encoding/json"
	"fmt"
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

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Config struct {
	DatabaseURL string
	SupabaseURL string
	Verifier    *auth.Verifier
	S3Endpoint  string
	S3Region    string
	S3Bucket    string
	S3AccessKey string
	S3SecretKey string
	EmojiBucket string
	Blob        blob.Store
	EmojiBlob   blob.Store
	CronSecret  string
}

type Server struct {
	pool        *pgxpool.Pool
	channels    *channel.Service
	posts       *post.Service
	search      *searchservice.Service
	changes     *changeservice.Service
	emojis      *emoji.Service
	emojiBlobs  blob.Store
	attachments *attachment.Service
	cronSecret  string
	mux         http.Handler
}

func newPoolConfig(databaseURL string) (*pgxpool.Config, error) {
	poolCfg, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		return nil, err
	}
	poolCfg.MaxConns = 2
	poolCfg.MaxConnIdleTime = 30 * time.Second
	// DescribeExec avoids named prepared statements (42P05 on Supavisor
	// transaction pooling) while still describing types so uuid[] encodes.
	poolCfg.ConnConfig.DefaultQueryExecMode = pgx.QueryExecModeDescribeExec
	return poolCfg, nil
}

func New(cfg Config) (*Server, error) {
	if cfg.DatabaseURL != "" && cfg.Verifier == nil && cfg.SupabaseURL == "" {
		return nil, fmt.Errorf("httpapi: Verifier or SUPABASE_URL is required when DATABASE_URL is set")
	}
	s := &Server{cronSecret: cfg.CronSecret, emojiBlobs: cfg.EmojiBlob}

	var users auth.UserStore
	if cfg.DatabaseURL != "" {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		poolCfg, err := newPoolConfig(cfg.DatabaseURL)
		if err != nil {
			return nil, err
		}
		pool, err := pgxpool.NewWithConfig(ctx, poolCfg)
		if err != nil {
			return nil, err
		}
		s.pool = pool
		st := store.NewStore(pool)
		users = st
		blobStore := cfg.Blob
		if blobStore == nil && cfg.S3Bucket != "" {
			s3, err := blob.NewS3(ctx, blob.S3Config{
				Endpoint:  cfg.S3Endpoint,
				Region:    cfg.S3Region,
				Bucket:    cfg.S3Bucket,
				AccessKey: cfg.S3AccessKey,
				SecretKey: cfg.S3SecretKey,
			})
			if err != nil {
				pool.Close()
				return nil, err
			}
			blobStore = s3
		}
		if s.emojiBlobs == nil && cfg.EmojiBucket != "" {
			emojiS3, err := blob.NewS3(ctx, blob.S3Config{
				Endpoint:  cfg.S3Endpoint,
				Region:    cfg.S3Region,
				Bucket:    cfg.EmojiBucket,
				AccessKey: cfg.S3AccessKey,
				SecretKey: cfg.S3SecretKey,
			})
			if err != nil {
				pool.Close()
				return nil, err
			}
			s.emojiBlobs = emojiS3
		}
		s.attachments = attachment.NewService(st.Queries, blobStore)
		s.channels = channel.NewService(st.Queries)
		s.posts = post.NewService(st.Queries, st.Pool, s.attachments)
		s.search = searchservice.NewService(st.Queries)
		s.changes = changeservice.NewService(st.Queries)
		s.emojis = emoji.NewService(st.Queries)
	}

	v := cfg.Verifier
	if v == nil && cfg.SupabaseURL != "" {
		v = auth.NewSupabaseVerifier(cfg.SupabaseURL, nil)
	}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /ready", s.GetHealth)
	mux.HandleFunc("POST /internal/attachments/reap", s.ReapAttachments)
	mux.HandleFunc("GET /internal/attachments/reap", s.ReapAttachments)
	mux.HandleFunc("POST /internal/events/prune", s.PruneChangeEvents)
	mux.HandleFunc("GET /internal/events/prune", s.PruneChangeEvents)
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

func (s *Server) ReapAttachments(w http.ResponseWriter, r *http.Request) {
	if !auth.BearerMatches(r.Header.Get("Authorization"), s.cronSecret) {
		writeAPIError(w, http.StatusUnauthorized, "unauthorized", "認可情報を検証できませんでした", nil)
		return
	}
	if s.attachments == nil {
		writeAPIError(w, http.StatusServiceUnavailable, "unavailable", "データベースに接続できません", nil)
		return
	}
	if err := s.attachments.Reap(r.Context()); err != nil {
		slog.ErrorContext(r.Context(), "attachment reaper failed", "error", safeLogError(err))
		writeAppError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) PruneChangeEvents(w http.ResponseWriter, r *http.Request) {
	if !auth.BearerMatches(r.Header.Get("Authorization"), s.cronSecret) {
		writeAPIError(w, http.StatusUnauthorized, "unauthorized", "認可情報を検証できませんでした", nil)
		return
	}
	if s.changes == nil {
		writeAPIError(w, http.StatusServiceUnavailable, "unavailable", "データベースに接続できません", nil)
		return
	}
	count, err := s.changes.PruneExpired(r.Context(), time.Now())
	if err != nil {
		slog.ErrorContext(r.Context(), "change event pruning failed", "error", safeLogError(err))
		writeAppError(w, r, err)
		return
	}
	slog.InfoContext(r.Context(), "change events pruned", "count", count)
	w.WriteHeader(http.StatusNoContent)
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

func (s *Server) Close() {
	if s.pool != nil {
		s.pool.Close()
	}
}
