package main

import (
	"os"
	"strings"
)

func listenAddr() string {
	if port := os.Getenv("PORT"); port != "" {
		if strings.HasPrefix(port, ":") {
			return port
		}
		return ":" + port
	}
	return env("LISTEN_ADDR", ":8080")
}
