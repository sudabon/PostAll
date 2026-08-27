package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/sudabon/PostAll/backend/internal/blob"
	"github.com/sudabon/PostAll/backend/internal/emoji"
	"github.com/sudabon/PostAll/backend/internal/httpapi"
	"github.com/sudabon/PostAll/backend/internal/migrate"
	"github.com/sudabon/PostAll/backend/internal/store"
)

func main() {
	databaseURL := os.Getenv("DATABASE_URL")
	if len(os.Args) > 1 {
		switch os.Args[1] {
		case "migrate":
			if databaseURL == "" {
				log.Fatal("migrate: DATABASE_URL is required")
			}
			if err := migrate.Up(databaseURL); err != nil {
				log.Fatalf("migrations: %v", err)
			}
			return
		case "migrate-check":
			if err := requireCurrentMigrations(databaseURL); err != nil {
				log.Fatalf("migrate-check: %v", err)
			}
			log.Print("migrate-check: database schema is current")
			return
		case "emoji-sync":
			if databaseURL == "" {
				log.Fatal("emoji-sync: DATABASE_URL is required")
			}
			if err := runEmojiSync(context.Background(), databaseURL, env("EMOJI_DIR", "../emoji")); err != nil {
				log.Fatalf("emoji-sync: %v", err)
			}
			return
		default:
			log.Fatalf("unknown command: %s", os.Args[1])
		}
	}

	addr := listenAddr()
	handler, err := httpapi.New(httpapi.Config{
		DatabaseURL: databaseURL,
		SupabaseURL: os.Getenv("SUPABASE_URL"),
		S3Endpoint:  os.Getenv("S3_ENDPOINT"),
		S3Region:    env("S3_REGION", "auto"),
		S3Bucket:    os.Getenv("S3_BUCKET"),
		S3AccessKey: firstEnv("S3_ACCESS_KEY_ID", "AWS_ACCESS_KEY_ID"),
		S3SecretKey: firstEnv("S3_SECRET_ACCESS_KEY", "AWS_SECRET_ACCESS_KEY"),
		EmojiBucket: os.Getenv("EMOJI_S3_BUCKET"),
		CronSecret:  os.Getenv("CRON_SECRET"),
	})
	if err != nil {
		log.Fatalf("init server: %v", err)
	}
	defer handler.Close()

	srv := &http.Server{
		Addr:              addr,
		Handler:           handler,
		ReadHeaderTimeout: 5 * time.Second,
	}

	go func() {
		log.Printf("listening on %s", addr)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("listen: %v", err)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	<-stop

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := srv.Shutdown(ctx); err != nil {
		log.Printf("shutdown: %v", err)
	}
}

func requireCurrentMigrations(databaseURL string) error {
	if databaseURL == "" {
		return fmt.Errorf("DATABASE_URL is required")
	}
	pending, err := migrate.Pending(databaseURL)
	if err != nil {
		return err
	}
	if len(pending) > 0 {
		return fmt.Errorf("pending database migrations: %s; run the migrate workflow first", strings.Join(pending, ", "))
	}
	return nil
}

func runEmojiSync(ctx context.Context, databaseURL, dir string) error {
	poolCfg, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		return err
	}
	poolCfg.ConnConfig.DefaultQueryExecMode = pgx.QueryExecModeDescribeExec
	pool, err := pgxpool.NewWithConfig(ctx, poolCfg)
	if err != nil {
		return err
	}
	defer pool.Close()

	bucket := os.Getenv("EMOJI_S3_BUCKET")
	skipStorage := os.Getenv("EMOJI_SKIP_STORAGE") == "1"
	if bucket == "" && !skipStorage {
		return fmt.Errorf("emoji-sync: EMOJI_S3_BUCKET is required")
	}

	var objects blob.Store
	if bucket != "" {
		s3store, err := blob.NewS3(ctx, blob.S3Config{
			Endpoint:  os.Getenv("S3_ENDPOINT"),
			Region:    env("S3_REGION", "auto"),
			Bucket:    bucket,
			AccessKey: firstEnv("S3_ACCESS_KEY_ID", "AWS_ACCESS_KEY_ID"),
			SecretKey: firstEnv("S3_SECRET_ACCESS_KEY", "AWS_SECRET_ACCESS_KEY"),
		})
		if err != nil {
			return err
		}
		objects = s3store
	}

	result, err := emoji.NewService(store.New(pool)).Sync(ctx, dir, objects)
	if err != nil {
		return err
	}
	for _, issue := range result.Issues {
		log.Printf("emoji-sync skipped file=%q reason=%q", issue.File, issue.Reason)
	}
	log.Printf(
		"emoji-sync complete created=%d updated=%d unchanged=%d skipped=%d",
		result.Created,
		result.Updated,
		result.Unchanged,
		result.Skipped,
	)
	return nil
}

func env(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func firstEnv(keys ...string) string {
	for _, key := range keys {
		if v := os.Getenv(key); v != "" {
			return v
		}
	}
	return ""
}
