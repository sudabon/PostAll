package post

import (
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
)

func EncodeCursor(createdAt time.Time, id uuid.UUID) string {
	return createdAt.UTC().Format(time.RFC3339Nano) + "_" + id.String()
}

func DecodeCursor(raw string) (time.Time, uuid.UUID, error) {
	i := strings.LastIndex(raw, "_")
	if i <= 0 || i == len(raw)-1 {
		return time.Time{}, uuid.Nil, fmt.Errorf("invalid cursor")
	}
	ts, err := time.Parse(time.RFC3339Nano, raw[:i])
	if err != nil {
		return time.Time{}, uuid.Nil, err
	}
	id, err := uuid.Parse(raw[i+1:])
	if err != nil {
		return time.Time{}, uuid.Nil, err
	}
	return ts, id, nil
}
