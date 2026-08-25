package sortkey

import (
	"errors"
	"strings"
)

const (
	alphabet    = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
	maxKeyLen   = 64
	rebalanceAt = 48
)

var (
	ErrOrder = errors.New("sortkey: prev is not less than next")
)

func First() string {
	return mid("", "")
}

func Between(prev, next string) (string, error) {
	if prev != "" && next != "" && prev >= next {
		return "", ErrOrder
	}
	key := mid(prev, next)
	if (prev != "" && key <= prev) || (next != "" && key >= next) {
		return "", ErrOrder
	}
	return key, nil
}

func NeedsRebalance(key string) bool {
	return len(key) >= rebalanceAt
}

func Rebalance(n int) []string {
	if n <= 0 {
		return nil
	}
	out := make([]string, n)
	lo, hi := "", ""
	for i := 0; i < n; i++ {
		out[i] = mid(lo, hi)
		lo = out[i]
	}
	// The above only grows to the right. Spread evenly instead:
	return spread(n)
}

func spread(n int) []string {
	out := make([]string, n)
	for i := 0; i < n; i++ {
		out[i] = rank(i+1, n+1)
	}
	return out
}

func rank(k, den int) string {
	slot := (len(alphabet) - 2) * k / den
	if slot < 1 {
		slot = 1
	}
	if slot >= len(alphabet)-1 {
		slot = len(alphabet) - 2
	}
	return string(alphabet[slot])
}

func mid(prev, next string) string {
	if prev == "" && next == "" {
		return string(alphabet[len(alphabet)/2])
	}
	if next == "" {
		return increment(prev)
	}
	if prev == "" {
		return decrement(next)
	}

	i := 0
	for i < len(prev) && i < len(next) && prev[i] == next[i] {
		i++
	}
	prefix := prev[:i]
	p := -1
	if i < len(prev) {
		p = index(prev[i])
	}
	n := len(alphabet)
	if i < len(next) {
		n = index(next[i])
	}
	if n-p >= 2 {
		return prefix + string(alphabet[p+(n-p)/2])
	}
	if i >= len(prev) {
		return prefix + mid("", next[i:])
	}
	return prefix + string(alphabet[p]) + mid(rest(prev, i+1), "")
}

func rest(s string, i int) string {
	if i >= len(s) {
		return ""
	}
	return s[i:]
}

func increment(s string) string {
	if s == "" {
		return string(alphabet[len(alphabet)/2])
	}
	last := index(s[len(s)-1])
	if last < len(alphabet)-2 {
		return s[:len(s)-1] + string(alphabet[last+1])
	}
	if len(s)+1 > maxKeyLen {
		return s[:maxKeyLen]
	}
	return s + string(alphabet[len(alphabet)/2])
}

func decrement(s string) string {
	if s == "" {
		return string(alphabet[len(alphabet)/2])
	}
	first := index(s[0])
	if first > 1 {
		return string(alphabet[first/2])
	}
	if s[0] == alphabet[0] || s[0] == alphabet[1] {
		if len(s) == 1 {
			return string(alphabet[0]) + string(alphabet[len(alphabet)/2])
		}
		return string(s[0]) + decrement(s[1:])
	}
	return string(alphabet[first-1])
}

func index(b byte) int {
	i := strings.IndexByte(alphabet, b)
	if i < 0 {
		return 0
	}
	return i
}
