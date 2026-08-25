#!/bin/sh
# Issue or renew the Let's Encrypt certificate, then copy it to the Nginx certs volume.
set -eu

if [ -z "${POSTALL_DOMAIN:-}" ] || [ -z "${CERTBOT_EMAIL:-}" ]; then
  echo "POSTALL_DOMAIN and CERTBOT_EMAIL are required" >&2
  exit 1
fi

certbot certonly \
  --webroot \
  --webroot-path /var/www/certbot \
  --email "$CERTBOT_EMAIL" \
  --agree-tos \
  --no-eff-email \
  --keep-until-expiring \
  --deploy-hook /usr/local/bin/deploy-hook.sh \
  -d "$POSTALL_DOMAIN"
