#!/usr/bin/env bash
# 暗号化したダンプの宛先を検査する。
#
#   verify-dump-recipients.sh <encrypted> <public-key>
#
# 次をすべて満たすときだけ 0 で終了する。
#   - 共通鍵で復号する経路（:symkey enc packet:）を含まない
#   - 公開鍵暗号の宛先（:pubkey enc packet:）が 1 つ以上ある
#   - 宛先の keyid がすべて <public-key> の暗号化用の鍵（capability e）である
#
# 検査は空の一時 GNUPGHOME で行う。秘密鍵を持たないので、成果物の外側のパケットだけを読む。
set -euo pipefail

if [ "$#" -ne 2 ]; then
  echo "usage: $0 <encrypted> <public-key>" >&2
  exit 2
fi
encrypted=$1
public_key=$2
for file in "$encrypted" "$public_key"; do
  if [ ! -s "$file" ]; then
    echo "verify-dump-recipients: $file is missing or empty" >&2
    exit 1
  fi
done

GNUPGHOME="$(mktemp -d)"
export GNUPGHOME
trap 'rm -rf "$GNUPGHOME"' EXIT

# 公開鍵ファイルのうち、暗号化に使える（失効・期限切れでない）鍵の keyid。
allowed="$(
  gpg --batch --with-colons --show-keys "$public_key" 2>/dev/null |
    awk -F: '($1 == "pub" || $1 == "sub") && $12 ~ /e/ && $2 !~ /[rei]/ { print toupper($5) }' |
    sort -u
)"
if [ -z "$allowed" ]; then
  echo "verify-dump-recipients: $public_key has no usable encryption key" >&2
  exit 1
fi

# 秘密鍵が無いので復号の段で gpg は非 0 になる。パケットの一覧だけを使う。
packets="$(gpg --batch --pinentry-mode cancel --list-packets "$encrypted" 2>/dev/null || true)"

if grep -q '^:symkey enc packet:' <<<"$packets"; then
  echo "verify-dump-recipients: $encrypted can be decrypted with a passphrase (symkey enc packet)" >&2
  exit 1
fi

pubkey_packets="$(grep -c '^:pubkey enc packet:' <<<"$packets" || true)"
keyids="$(sed -n 's/^:pubkey enc packet:.*keyid \([0-9A-Fa-f]\{16\}\).*/\1/p' <<<"$packets" | tr '[:lower:]' '[:upper:]')"
if [ "$pubkey_packets" -eq 0 ] || [ -z "$keyids" ]; then
  echo "verify-dump-recipients: $encrypted is not encrypted to a public key" >&2
  exit 1
fi
if [ "$(wc -l <<<"$keyids")" -ne "$pubkey_packets" ]; then
  echo "verify-dump-recipients: $encrypted has a recipient without a readable keyid" >&2
  exit 1
fi
recipients="$(sort -u <<<"$keyids")"

unexpected="$(comm -23 <(printf '%s\n' "$recipients") <(printf '%s\n' "$allowed"))"
if [ -n "$unexpected" ]; then
  echo "verify-dump-recipients: $encrypted is encrypted to unexpected keys:" >&2
  printf '  %s\n' "$unexpected" >&2
  exit 1
fi

echo "verify-dump-recipients: OK ($(tr '\n' ' ' <<<"$recipients"))"
