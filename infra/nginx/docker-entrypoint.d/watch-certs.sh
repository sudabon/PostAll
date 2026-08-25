#!/bin/sh
# Reload Nginx when certificates on disk change (Certbot deploy / renew).
set -eu

watch_certs() {
  while true; do
    inotifywait -e modify,create,move,delete -r /etc/nginx/certs >/dev/null 2>&1 || true
    echo "certificate change detected; reloading nginx"
    nginx -s reload || true
  done
}

watch_certs &
