package search

import "strings"

// ContainsPattern builds a LIKE/ILIKE pattern that matches query as a literal
// substring. `%`, `_`, and `\` are escaped so they are not interpreted as
// pattern metacharacters.
func ContainsPattern(query string) string {
	var b strings.Builder
	b.Grow(len(query) + 2)
	b.WriteByte('%')
	for i := 0; i < len(query); i++ {
		c := query[i]
		if c == '%' || c == '_' || c == '\\' {
			b.WriteByte('\\')
		}
		b.WriteByte(c)
	}
	b.WriteByte('%')
	return b.String()
}
