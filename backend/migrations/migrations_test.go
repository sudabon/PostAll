package migrations

import (
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
	if strings.Contains(contents, "using (true)") {
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

func TestPGroongaDownRestoresBigmBeforeDroppingPGroonga(t *testing.T) {
	contents := strings.ToLower(migration(t, "00008_pgroonga.sql"))
	assertOrdered(t, contents,
		"-- +goose down",
		"create extension if not exists pg_bigm",
		"create index posts_body_bigm",
		"drop index if exists posts_body_pgroonga",
	)
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
