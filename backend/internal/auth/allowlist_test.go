package auth

import (
	"slices"
	"testing"
)

const (
	allowedSubA = "6f1c2a3b-0000-4000-8000-00000000000a"
	allowedSubB = "6f1c2a3b-0000-4000-8000-00000000000b"
)

func TestParseAllowedSubjects(t *testing.T) {
	tests := []struct {
		name string
		raw  string
		want []string
	}{
		{name: "empty string", raw: "", want: []string{}},
		{name: "whitespace only", raw: "  \t ", want: []string{}},
		{name: "commas and blanks only", raw: " , ,, ", want: []string{}},
		{name: "single", raw: allowedSubA, want: []string{allowedSubA}},
		{name: "surrounding whitespace", raw: "  " + allowedSubA + " ,\t" + allowedSubB + "\n", want: []string{allowedSubA, allowedSubB}},
		{name: "mixed case is lowered", raw: "6F1C2A3B-0000-4000-8000-00000000000A", want: []string{allowedSubA}},
		{name: "duplicates collapse", raw: allowedSubA + "," + allowedSubA + ", 6F1C2A3B-0000-4000-8000-00000000000A", want: []string{allowedSubA}},
		{name: "empty elements ignored", raw: "," + allowedSubB + ",," + allowedSubA + ",", want: []string{allowedSubA, allowedSubB}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := ParseAllowedSubjects(tt.raw)
			if !slices.Equal(got.Subjects(), tt.want) {
				t.Fatalf("Subjects()=%q, want %q", got.Subjects(), tt.want)
			}
			if got.Len() != len(tt.want) {
				t.Fatalf("Len()=%d, want %d", got.Len(), len(tt.want))
			}
		})
	}
}

func TestAllowedSubjectsUnsetAllowsNobody(t *testing.T) {
	var unset AllowedSubjects
	for _, sub := range []string{allowedSubA, "", " "} {
		if unset.Allows(sub) {
			t.Fatalf("zero value allowed %q", sub)
		}
	}
	if unset.Len() != 0 {
		t.Fatalf("Len()=%d", unset.Len())
	}
	if got := NewAllowedSubjects(); got.Allows(allowedSubA) {
		t.Fatal("empty set allowed a subject")
	}
}

func TestAllowedSubjectsAllows(t *testing.T) {
	a := ParseAllowedSubjects(" " + allowedSubA + " ")
	if !a.Allows(allowedSubA) {
		t.Fatal("listed subject rejected")
	}
	if !a.Allows("6F1C2A3B-0000-4000-8000-00000000000A") {
		t.Fatal("subject comparison should ignore case")
	}
	if a.Allows(allowedSubB) {
		t.Fatal("unlisted subject allowed")
	}
	if a.Allows("") {
		t.Fatal("empty subject allowed")
	}
}
