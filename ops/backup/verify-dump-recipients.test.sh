#!/usr/bin/env bash
# verify-dump-recipients.sh の単体試験。使い捨ての鍵で成果物を作り、終了コードを確かめる。
#
#   bash ops/backup/verify-dump-recipients.test.sh
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
verify="$script_dir/verify-dump-recipients.sh"

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
GNUPGHOME="$work/gnupg"
export GNUPGHOME
mkdir -m 700 "$GNUPGHOME"

gen_key() {
  local uid=$1 out=$2
  gpg --batch --quiet --pinentry-mode loopback --passphrase '' \
    --quick-gen-key "$uid" future-default default never
  gpg --batch --armor --export "$uid" >"$out"
}
gen_key 'PostAll backup test A <backup-a@example.invalid>' "$work/a.pub.asc"
gen_key 'PostAll backup test B <backup-b@example.invalid>' "$work/b.pub.asc"

printf 'COPY public.posts (body) FROM stdin;\nsecret\n\\.\n' | gzip -9 >"$work/dump.sql.gz"

encrypt() {
  local out=$1
  shift
  gpg --batch --yes --quiet --trust-model always --pinentry-mode loopback --passphrase 'shared-secret' \
    --output "$work/$out" "$@" "$work/dump.sql.gz"
}
encrypt recipient-a.gpg --recipient-file "$work/a.pub.asc" --encrypt
encrypt symmetric.gpg --symmetric
encrypt recipient-b.gpg --recipient-file "$work/b.pub.asc" --encrypt
encrypt recipient-a-and-symmetric.gpg --recipient-file "$work/a.pub.asc" --encrypt --symmetric
encrypt recipient-a-and-b.gpg --recipient-file "$work/a.pub.asc" --recipient-file "$work/b.pub.asc" --encrypt
printf 'not an OpenPGP message\n' >"$work/plain.gpg"

failures=0
expect() {
  local want=$1 name=$2 file=$3
  local got=0
  bash "$verify" "$work/$file" "$work/a.pub.asc" >"$work/out.log" 2>&1 || got=$?
  if { [ "$want" = pass ] && [ "$got" -eq 0 ]; } || { [ "$want" = fail ] && [ "$got" -ne 0 ]; }; then
    echo "ok   - $name (exit $got)"
  else
    echo "FAIL - $name: want $want, got exit $got"
    sed 's/^/       /' "$work/out.log"
    failures=$((failures + 1))
  fi
}

expect pass 'encrypted to the backup key' recipient-a.gpg
expect fail 'symmetric (--symmetric)' symmetric.gpg
expect fail 'encrypted to another key' recipient-b.gpg
expect fail 'backup key and a passphrase together' recipient-a-and-symmetric.gpg
expect fail 'backup key and another key together' recipient-a-and-b.gpg
expect fail 'not encrypted at all' plain.gpg

if [ "$failures" -ne 0 ]; then
  echo "$failures case(s) failed" >&2
  exit 1
fi
echo "all cases passed"
