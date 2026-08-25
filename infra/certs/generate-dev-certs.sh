#!/bin/sh
# Generate a self-signed certificate for local HTTPS (localhost).
set -eu
ROOT="$(cd "$(dirname "$0")" && pwd)"
mkdir -p "$ROOT"
openssl req -x509 -nodes -newkey rsa:2048 -days 365 \
  -keyout "$ROOT/privkey.pem" \
  -out "$ROOT/fullchain.pem" \
  -subj "/CN=localhost" \
  -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"
echo "wrote $ROOT/fullchain.pem and $ROOT/privkey.pem"
