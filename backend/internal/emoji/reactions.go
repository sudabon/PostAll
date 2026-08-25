package emoji

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/sudabon/PostAll/backend/internal/store"
)

type CatalogItem struct {
	ID         uuid.UUID
	Shortcode  string
	StorageKey string
	Checksum   string
	CreatedAt  time.Time
}

type ReactionSummary struct {
	Emoji          CatalogItem
	ReactorIDs     []uuid.UUID
	FirstReactedAt time.Time
}

func (s *Service) List(ctx context.Context) ([]CatalogItem, error) {
	rows, err := s.q.ListEmojis(ctx)
	if err != nil {
		return nil, err
	}
	items := make([]CatalogItem, 0, len(rows))
	for _, row := range rows {
		items = append(items, catalogItem(row))
	}
	return items, nil
}

func (s *Service) GetByShortcode(ctx context.Context, shortcode string) (CatalogItem, error) {
	row, err := s.q.GetEmojiByShortcode(ctx, shortcode)
	if errors.Is(err, pgx.ErrNoRows) {
		return CatalogItem{}, errNotFound("絵文字が見つかりません")
	}
	if err != nil {
		return CatalogItem{}, err
	}
	return catalogItem(row), nil
}

func (s *Service) AddReaction(ctx context.Context, postID, emojiID, userID uuid.UUID) (ReactionSummary, error) {
	if err := s.validateTarget(ctx, postID, emojiID); err != nil {
		return ReactionSummary{}, err
	}
	if err := s.q.InsertReaction(ctx, store.InsertReactionParams{
		PostID: postID, EmojiID: emojiID, UserID: userID,
	}); err != nil {
		return ReactionSummary{}, err
	}
	grouped, err := s.ListReactionsForPosts(ctx, []uuid.UUID{postID})
	if err != nil {
		return ReactionSummary{}, err
	}
	for _, summary := range grouped[postID] {
		if summary.Emoji.ID == emojiID {
			return summary, nil
		}
	}
	return ReactionSummary{}, fmt.Errorf("reaction was not returned after insert")
}

func (s *Service) RemoveReaction(ctx context.Context, postID, emojiID, userID uuid.UUID) error {
	if err := s.validateTarget(ctx, postID, emojiID); err != nil {
		return err
	}
	return s.q.DeleteReaction(ctx, store.DeleteReactionParams{
		PostID: postID, EmojiID: emojiID, UserID: userID,
	})
}

func (s *Service) ListReactionsForPosts(ctx context.Context, postIDs []uuid.UUID) (map[uuid.UUID][]ReactionSummary, error) {
	grouped := make(map[uuid.UUID][]ReactionSummary, len(postIDs))
	if len(postIDs) == 0 {
		return grouped, nil
	}
	rows, err := s.q.ListReactionRowsForPosts(ctx, postIDs)
	if err != nil {
		return nil, err
	}
	positions := make(map[uuid.UUID]map[uuid.UUID]int, len(postIDs))
	for _, row := range rows {
		byEmoji := positions[row.PostID]
		if byEmoji == nil {
			byEmoji = make(map[uuid.UUID]int)
			positions[row.PostID] = byEmoji
		}
		position, ok := byEmoji[row.EmojiID]
		if !ok {
			position = len(grouped[row.PostID])
			byEmoji[row.EmojiID] = position
			grouped[row.PostID] = append(grouped[row.PostID], ReactionSummary{
				Emoji: CatalogItem{
					ID: row.EmojiID, Shortcode: row.Shortcode, StorageKey: row.StorageKey,
					Checksum: row.Checksum, CreatedAt: row.EmojiCreatedAt,
				},
				ReactorIDs:     []uuid.UUID{},
				FirstReactedAt: row.ReactedAt,
			})
		}
		summaries := grouped[row.PostID]
		summaries[position].ReactorIDs = append(summaries[position].ReactorIDs, row.UserID)
		grouped[row.PostID] = summaries
	}
	return grouped, nil
}

func (s *Service) validateTarget(ctx context.Context, postID, emojiID uuid.UUID) error {
	post, err := s.q.GetPost(ctx, postID)
	if errors.Is(err, pgx.ErrNoRows) {
		return errNotFound("ポストが見つかりません")
	}
	if err != nil {
		return err
	}
	if post.DeletedAt != nil {
		return errPostDeleted()
	}
	if _, err := s.q.GetEmojiByID(ctx, emojiID); errors.Is(err, pgx.ErrNoRows) {
		return errNotFound("絵文字が見つかりません")
	} else if err != nil {
		return err
	}
	return nil
}

func catalogItem(row store.Emoji) CatalogItem {
	return CatalogItem{
		ID: row.ID, Shortcode: row.Shortcode, StorageKey: row.StorageKey,
		Checksum: row.Checksum, CreatedAt: row.CreatedAt,
	}
}
