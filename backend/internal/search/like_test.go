package search

import "testing"

func TestContainsPatternEscapesMetacharacters(t *testing.T) {
	cases := []struct {
		in, want string
	}{
		{"ab", "%ab%"},
		{"a%b", `%a\%b%`},
		{"a_b", `%a\_b%`},
		{`a\b`, `%a\\b%`},
		{`%_\\`, `%\%\_\\\\%`},
		{"日本語", "%日本語%"},
	}
	for _, tc := range cases {
		if got := ContainsPattern(tc.in); got != tc.want {
			t.Fatalf("ContainsPattern(%q)=%q want %q", tc.in, got, tc.want)
		}
	}
}
