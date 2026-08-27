package migrations

import (
	"regexp"
	"strings"
	"testing"
)

func TestRealtimePolicyIsTopicAndExtensionScoped(t *testing.T) {
	contents := migration(t, "00011_realtime_rls.sql")
	for _, required := range []string{
		"realtime.topic() = 'postall:events'",
		"extension = 'broadcast'",
	} {
		if !strings.Contains(contents, required) {
			t.Errorf("migration is missing %q", required)
		}
	}
	if regexp.MustCompile(`using\s*\(\s*true\s*\)`).MatchString(strings.ToLower(contents)) {
		t.Fatal("migration still grants unscoped realtime.messages SELECT")
	}
}

func TestBestEffortNotificationIsObservable(t *testing.T) {
	contents := strings.ToLower(migration(t, "00012_realtime_notify_best_effort.sql"))
	if !strings.Contains(contents, "raise warning") {
		t.Fatal("notification errors are still silent")
	}
	if !strings.Contains(contents, "sqlstate") || !strings.Contains(contents, "sqlerrm") {
		t.Fatal("warning does not record SQLSTATE and the database error")
	}
}

func TestPGroongaDownDropsIndexAndExtension(t *testing.T) {
	contents := strings.ToLower(migration(t, "00008_pgroonga.sql"))
	down := contents[strings.Index(contents, "-- +goose down"):]
	if strings.Contains(down, "pg_bigm") || strings.Contains(down, "posts_body_bigm") {
		t.Fatal("down still requires pg_bigm")
	}
	assertOrdered(t, contents,
		"-- +goose down",
		"drop index if exists posts_body_pgroonga",
		"drop extension if exists pgroonga",
	)
}

func TestChangeEventRetentionStateIsLockedDown(t *testing.T) {
	contents := strings.ToLower(migration(t, "00015_change_event_retention.sql"))
	for _, required := range []string{
		"alter table change_event_retention enable row level security",
		"revoke all on table change_event_retention",
	} {
		if !strings.Contains(contents, required) {
			t.Errorf("retention migration is missing %q", required)
		}
	}
}

func migration(t *testing.T, name string) string {
	t.Helper()
	contents, err := Files.ReadFile(name)
	if err != nil {
		t.Fatal(err)
	}
	return string(contents)
}

func assertOrdered(t *testing.T, contents string, values ...string) {
	t.Helper()
	position := 0
	for _, value := range values {
		next := strings.Index(contents[position:], value)
		if next < 0 {
			t.Fatalf("%q is missing or out of order", value)
		}
		position += next + len(value)
	}
}
