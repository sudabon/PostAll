package auth

import (
	"slices"
	"strings"
)

// AllowedSubjects は API の利用を許可する認証サービスの識別子（JWT の sub）の集合である。
// 空の集合は誰も許可しない（fail-closed）。
type AllowedSubjects struct {
	set map[string]struct{}
}

// ParseAllowedSubjects はカンマ区切りの文字列から許可集合を作る。
func ParseAllowedSubjects(raw string) AllowedSubjects {
	return NewAllowedSubjects(strings.Split(raw, ",")...)
}

// NewAllowedSubjects は前後の空白と空要素を除き、小文字に正規化して許可集合を作る。
func NewAllowedSubjects(subjects ...string) AllowedSubjects {
	set := make(map[string]struct{}, len(subjects))
	for _, s := range subjects {
		s = normalizeSubject(s)
		if s == "" {
			continue
		}
		set[s] = struct{}{}
	}
	return AllowedSubjects{set: set}
}

func (a AllowedSubjects) Allows(sub string) bool {
	s := normalizeSubject(sub)
	if s == "" {
		return false
	}
	_, ok := a.set[s]
	return ok
}

func (a AllowedSubjects) Len() int {
	return len(a.set)
}

// Subjects は正規化済みの識別子を昇順で返す。
func (a AllowedSubjects) Subjects() []string {
	out := make([]string, 0, len(a.set))
	for s := range a.set {
		out = append(out, s)
	}
	slices.Sort(out)
	return out
}

func normalizeSubject(s string) string {
	return strings.ToLower(strings.TrimSpace(s))
}
