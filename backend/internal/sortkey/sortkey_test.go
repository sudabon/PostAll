package sortkey

import (
	"strings"
	"testing"
)

func TestBetweenIsOrdered(t *testing.T) {
	a := First()
	b, err := Between(a, "")
	if err != nil {
		t.Fatal(err)
	}
	c, err := Between(b, "")
	if err != nil {
		t.Fatal(err)
	}
	if !(a < b && b < c) {
		t.Fatalf("order: %q %q %q", a, b, c)
	}
}

func TestInsertBetweenNeighbors(t *testing.T) {
	left := First()
	right, err := Between(left, "")
	if err != nil {
		t.Fatal(err)
	}
	mid, err := Between(left, right)
	if err != nil {
		t.Fatal(err)
	}
	if !(left < mid && mid < right) {
		t.Fatalf("between: %q < %q < %q", left, mid, right)
	}
}

func TestRejectsInvertedNeighbors(t *testing.T) {
	a := First()
	b, err := Between(a, "")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := Between(b, a); err == nil {
		t.Fatal("expected ErrOrder")
	}
}

func TestRepeatedInsertsStayComparable(t *testing.T) {
	keys := []string{First()}
	for range 40 {
		next, err := Between(keys[len(keys)-1], "")
		if err != nil {
			t.Fatal(err)
		}
		if next <= keys[len(keys)-1] {
			t.Fatalf("not increasing: %q then %q", keys[len(keys)-1], next)
		}
		keys = append(keys, next)
	}
}

func TestRebalancePreservesCountAndOrder(t *testing.T) {
	keys := Rebalance(10)
	if len(keys) != 10 {
		t.Fatalf("len=%d", len(keys))
	}
	for i := 1; i < len(keys); i++ {
		if keys[i-1] >= keys[i] {
			t.Fatalf("not sorted: %q >= %q", keys[i-1], keys[i])
		}
	}
}

func TestNeedsRebalance(t *testing.T) {
	if NeedsRebalance("a") {
		t.Fatal("short key should not rebalance")
	}
	long := strings.Repeat("a", rebalanceAt)
	if !NeedsRebalance(long) {
		t.Fatal("long key should rebalance")
	}
}
