#!/bin/sh
# Fail if postgres or api publish a host port (they must stay off the public internet).
set -eu
cd "$(dirname "$0")/.."

if docker compose port postgres 5432 >/tmp/postall-port-pg 2>/tmp/postall-port-pg-err; then
  echo "postgres 5432 is published: $(cat /tmp/postall-port-pg)" >&2
  exit 1
fi
if docker compose port api 8080 >/tmp/postall-port-api 2>/tmp/postall-port-api-err; then
  echo "api 8080 is published: $(cat /tmp/postall-port-api)" >&2
  exit 1
fi
echo "postgres and api host ports are not published"
