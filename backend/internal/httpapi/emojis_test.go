package httpapi

import (
	"testing"

	"github.com/google/uuid"
	"github.com/sudabon/PostAll/backend/internal/emoji"
)

func TestToAPIReactionPutsViewerFirst(t *testing.T) {
	viewerID := uuid.MustParse("11111111-1111-1111-1111-111111111111")
	otherID := uuid.MustParse("22222222-2222-2222-2222-222222222222")
	reaction := toAPIReaction(emoji.ReactionSummary{
		Emoji:      emoji.CatalogItem{ID: uuid.New(), Shortcode: "shipit"},
		ReactorIDs: []uuid.UUID{otherID, viewerID},
	}, viewerID)

	if !reaction.ReactedByMe {
		t.Fatal("viewer reaction was not detected")
	}
	if got := uuid.UUID(reaction.ReactorIds[0]); got != viewerID {
		t.Fatalf("first reactor = %s, want viewer %s", got, viewerID)
	}
	if got := uuid.UUID(reaction.ReactorIds[1]); got != otherID {
		t.Fatalf("second reactor = %s, want other %s", got, otherID)
	}
}
