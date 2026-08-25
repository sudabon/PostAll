package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/sudabon/PostAll/backend/internal/emoji"
	"github.com/sudabon/PostAll/backend/internal/httpapi"
	"github.com/sudabon/PostAll/backend/internal/migrate"
	"github.com/sudabon/PostAll/backend/internal/store"
)

func main() {
	addr := env("LISTEN_ADDR", ":8080")
	databaseURL := os.Getenv("DATABASE_URL")

	if databaseURL != "" {
		if err := migrate.Up(databaseURL); err != nil {
			log.Fatalf("migrations: %v", err)
		}
	}
	if len(os.Args) > 1 {
		switch os.Args[1] {
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

	handler, err := httpapi.New(httpapi.Config{
		DatabaseURL:       databaseURL,
		AWSRegion:         os.Getenv("AWS_REGION"),
		CognitoUserPoolID: os.Getenv("AWS_COGNITO_USER_POOL_ID"),
		CognitoClientID:   os.Getenv("AWS_COGNITO_CLIENT_ID"),
		S3Bucket:          os.Getenv("S3_BUCKET"),
		EmojiDir:          env("EMOJI_DIR", "../emoji"),
		ReaperInterval:    15 * time.Minute,
	})
	if err != nil {
		log.Fatalf("init server: %v", err)
	}

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

func runEmojiSync(ctx context.Context, databaseURL, dir string) error {
	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		return err
	}
	defer pool.Close()

	result, err := emoji.NewService(store.New(pool)).Sync(ctx, dir)
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
