package migrate

import "testing"

func TestOpenUsesSingleConnWithoutNamedPrepares(t *testing.T) {
	db, err := open("postgres://postall:postall@127.0.0.1:5432/postall?sslmode=disable")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	if db.Stats().MaxOpenConnections != 1 {
		t.Fatalf("max open connections = %d, want 1", db.Stats().MaxOpenConnections)
	}
}
