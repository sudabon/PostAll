#!/bin/sh
# Copy the newly issued/renewed cert into the volume Nginx actually reads.
set -eu

LIVE="/etc/letsencrypt/live/${POSTALL_DOMAIN}"
DEST="/etc/nginx/certs"

if [ ! -f "$LIVE/fullchain.pem" ] || [ ! -f "$LIVE/privkey.pem" ]; then
  echo "live certificate not found under $LIVE" >&2
  exit 1
fi

cp "$LIVE/fullchain.pem" "$DEST/fullchain.pem"
cp "$LIVE/privkey.pem" "$DEST/privkey.pem"
echo "copied certificate for ${POSTALL_DOMAIN} to $DEST"
