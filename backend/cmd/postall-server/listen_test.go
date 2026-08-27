package main

import "testing"

func TestListenAddrPrefersPORT(t *testing.T) {
	t.Setenv("LISTEN_ADDR", ":9999")
	t.Setenv("PORT", "3000")
	if got := listenAddr(); got != ":3000" {
		t.Fatalf("listenAddr()=%q want :3000", got)
	}
}

func TestListenAddrFallsBackToListenAddr(t *testing.T) {
	t.Setenv("PORT", "")
	t.Setenv("LISTEN_ADDR", ":9090")
	if got := listenAddr(); got != ":9090" {
		t.Fatalf("listenAddr()=%q want :9090", got)
	}
}

func TestListenAddrDefault(t *testing.T) {
	t.Setenv("PORT", "")
	t.Setenv("LISTEN_ADDR", "")
	if got := listenAddr(); got != ":8080" {
		t.Fatalf("listenAddr()=%q want :8080", got)
	}
}
