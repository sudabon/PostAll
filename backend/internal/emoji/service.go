package emoji

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/sudabon/PostAll/backend/internal/blob"
	"github.com/sudabon/PostAll/backend/internal/store"
)

type Service struct {
	q *store.Queries
}

func NewService(q *store.Queries) *Service {
	return &Service{q: q}
}

type SyncIssue struct {
	File   string
	Reason string
}

type SyncResult struct {
	Created   int
	Updated   int
	Unchanged int
	Skipped   int
	Issues    []SyncIssue
}

func (s *Service) Sync(ctx context.Context, dir string, objects blob.Store) (SyncResult, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return SyncResult{}, fmt.Errorf("read emoji directory: %w", err)
	}

	result := SyncResult{Issues: []SyncIssue{}}
	for _, entry := range entries {
		name := entry.Name()
		if entry.IsDir() || !entry.Type().IsRegular() {
			result.skip(name, "通常ファイルではありません")
			continue
		}
		if filepath.Ext(name) != ".png" {
			result.skip(name, "PNG ファイルではありません")
			continue
		}
		shortcode := strings.TrimSuffix(name, ".png")
		if !ValidShortcode(shortcode) {
			result.skip(name, "ショートコードとして不正なファイル名です")
			continue
		}

		path := filepath.Join(dir, name)
		checksum, err := fileChecksum(path)
		if err != nil {
			return result, fmt.Errorf("checksum %s: %w", name, err)
		}
		existing, err := s.q.GetEmojiByShortcode(ctx, shortcode)
		switch {
		case errors.Is(err, pgx.ErrNoRows):
			if err := putEmojiObject(ctx, objects, path, name); err != nil {
				return result, fmt.Errorf("upload emoji %s: %w", shortcode, err)
			}
			if _, err := s.q.InsertEmoji(ctx, store.InsertEmojiParams{
				Shortcode:  shortcode,
				StorageKey: name,
				Checksum:   checksum,
			}); err != nil {
				return result, fmt.Errorf("insert emoji %s: %w", shortcode, err)
			}
			result.Created++
		case err != nil:
			return result, fmt.Errorf("get emoji %s: %w", shortcode, err)
		case existing.Checksum == checksum && existing.StorageKey == name:
			if objects == nil {
				result.Unchanged++
				continue
			}
			exists, _, err := objects.Head(ctx, name)
			if err != nil {
				return result, fmt.Errorf("head emoji %s: %w", shortcode, err)
			}
			if exists {
				result.Unchanged++
				continue
			}
			if err := putEmojiObject(ctx, objects, path, name); err != nil {
				return result, fmt.Errorf("repair emoji %s: %w", shortcode, err)
			}
			result.Updated++
		default:
			if err := putEmojiObject(ctx, objects, path, name); err != nil {
				return result, fmt.Errorf("upload emoji %s: %w", shortcode, err)
			}
			if _, err := s.q.UpdateEmoji(ctx, store.UpdateEmojiParams{
				StorageKey: name,
				Checksum:   checksum,
				Shortcode:  shortcode,
			}); err != nil {
				return result, fmt.Errorf("update emoji %s: %w", shortcode, err)
			}
			result.Updated++
		}
	}
	return result, nil
}

func (r *SyncResult) skip(file, reason string) {
	r.Skipped++
	r.Issues = append(r.Issues, SyncIssue{File: file, Reason: reason})
}

func fileChecksum(path string) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()
	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return "", err
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

func putEmojiObject(ctx context.Context, objects blob.Store, path, key string) error {
	if objects == nil {
		return nil
	}
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil {
		return err
	}
	return objects.Put(ctx, key, "image/png", f, info.Size())
}
