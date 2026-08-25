#!/bin/sh
set -eu

INFRA_DIR="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
COMPOSE_FILE="$INFRA_DIR/tests/docker-compose.sse.yml"
PROJECT_NAME="postall-sse-proxy-test"
TEST_PORT="${POSTALL_SSE_TEST_PORT:-18443}"
OUTPUT_FILE="$(mktemp)"

cleanup() {
  docker compose --project-name "$PROJECT_NAME" -f "$COMPOSE_FILE" down --volumes --remove-orphans >/dev/null 2>&1 || true
  rm -f "$OUTPUT_FILE"
}
trap cleanup EXIT INT TERM

if [ ! -f "$INFRA_DIR/certs/fullchain.pem" ] || [ ! -f "$INFRA_DIR/certs/privkey.pem" ]; then
  "$INFRA_DIR/certs/generate-dev-certs.sh"
fi

docker compose --project-name "$PROJECT_NAME" -f "$COMPOSE_FILE" up --detach --build

attempt=0
until curl --insecure --silent --show-error --fail --max-time 2 "https://127.0.0.1:$TEST_PORT/health" >/dev/null; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 20 ]; then
    echo "Nginx SSE test proxy did not become ready" >&2
    docker compose --project-name "$PROJECT_NAME" -f "$COMPOSE_FILE" logs >&2
    exit 1
  fi
  sleep 1
done

set +e
curl --insecure --silent --show-error --no-buffer --max-time 3 \
  "https://127.0.0.1:$TEST_PORT/v1/events/stream" >"$OUTPUT_FILE"
CURL_STATUS=$?
set -e

if [ "$CURL_STATUS" -ne 0 ] && [ "$CURL_STATUS" -ne 28 ]; then
  echo "SSE request failed with curl status $CURL_STATUS" >&2
  exit 1
fi
if ! grep -q '^event: post.created$' "$OUTPUT_FILE"; then
  echo "The first SSE frame was buffered or missing" >&2
  exit 1
fi

echo "SSE frame arrived through Nginx before the upstream response closed"
