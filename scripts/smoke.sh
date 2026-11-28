#!/bin/sh
# Smoke one Release asset: the commands every Release must answer, run the way an
# install leaves them — one binary, no repository around it.
#
# Usage: sh scripts/smoke.sh <ez-<os>-<arch>.gz>
#
# The archive is unpacked and pointed at a Scene the suite already keeps valid,
# so a binary that lost its core bundle, Kalam's metrics, resvg, its page or its
# skill fails here instead of in someone's install. Run it on the machine the
# asset ships to: `ez serve` is asked for the page it would serve a browser.
set -eu

[ $# -eq 1 ] || {
  printf '%s\n' 'usage: smoke.sh <ez-<os>-<arch>.gz>' >&2
  exit 2
}

here=$(CDPATH='' cd -- "$(dirname "$0")" && pwd)
asset=$1
[ -f "$asset" ] || {
  printf 'smoke: no such asset: %s\n' "$asset" >&2
  exit 1
}

work=$(mktemp -d) || {
  printf 'smoke: cannot make a temporary folder\n' >&2
  exit 1
}
serve=''
cleanup() {
  [ -z "$serve" ] || kill "$serve" 2>/dev/null || true
  rm -rf "$work"
}
trap cleanup EXIT INT TERM

gunzip -c "$asset" >"$work/ez" || {
  printf 'smoke: cannot unpack %s\n' "$asset" >&2
  exit 1
}
chmod 755 "$work/ez"
cp "$here/../test/fixtures/small.json" "$work/scene.json"

# One line per command, and the failing command's own output underneath it.
step() {
  label=$1
  shift
  printf 'smoke: %s ' "$label"
  if "$@" >"$work/out" 2>"$work/err"; then
    printf 'ok\n'
  else
    printf 'FAILED\n'
    cat "$work/out" "$work/err" >&2
    exit 1
  fi
}

step check "$work/ez" check "$work/scene.json"
step render "$work/ez" render "$work/scene.json"
step png "$work/ez" png "$work/scene.json" --theme light
step bundle "$work/ez" bundle "$work"
step skill "$work/ez" skill

# The port is the operating system's, so a run never fights another for one.
printf 'smoke: serve '
"$work/ez" serve "$work" --port 0 >"$work/serve.out" 2>&1 &
serve=$!
waited=0
while ! grep -q '^serving ' "$work/serve.out" 2>/dev/null; do
  waited=$((waited + 1))
  if [ "$waited" -gt 100 ]; then
    printf 'FAILED\n'
    cat "$work/serve.out" >&2
    exit 1
  fi
  sleep 0.1
done
url=$(sed -n 's/^serving .* on \(http[^ ]*\)\/.*$/\1/p' "$work/serve.out" | head -n 1)
if [ -z "$url" ] || ! curl -fsS "$url/" >"$work/page.html" || ! grep -q '<esbozo-editor' "$work/page.html"; then
  printf 'FAILED\n'
  cat "$work/serve.out" >&2
  exit 1
fi
kill "$serve"
wait "$serve" 2>/dev/null || true
serve=''
printf 'ok\n'

printf 'smoke: %s passed\n' "$asset"
