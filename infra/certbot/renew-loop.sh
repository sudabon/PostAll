#!/bin/sh
# Loop: wait, then attempt renewal. Failures are logged; Nginx keeps serving the old cert.
set -eu

INTERVAL="${CERTBOT_RENEW_INTERVAL:-43200}"

while true; do
  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) certbot renew starting"
  if certbot renew --webroot --webroot-path /var/www/certbot --deploy-hook /usr/local/bin/deploy-hook.sh; then
    echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) certbot renew succeeded"
  else
    echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) certbot renew failed" >&2
  fi
  sleep "$INTERVAL"
done
