#!/bin/sh
#
# Install ez, the esbozo command line, from a GitHub release.
#
#   curl -fsSL https://esbozo.vieitesss.eu/install | sh
#
# POSIX sh, on Linux and macOS, x64 and arm64, and never with sudo. The binary
# lands in `${ESBOZO_INSTALL_DIR:-$HOME/.local/bin}/ez` with an `esbozo` symlink
# beside it, or in `--dir` when one is given. No flag installs the latest
# Release; `--main` installs the rolling Main build and `--version X.Y.Z` that
# Release. Downloads are checked against the release's `SHA256SUMS` and swapped
# in with an atomic rename, so a refused download leaves an existing install
# untouched and one already on the target is left alone.
#
# `ez update` re-runs this script with the flags it was given plus `--dir` set
# to its own folder.
set -eu

RELEASE_URL="${ESBOZO_RELEASE_URL:-https://github.com/vieitesss/esbozo/releases}"

usage() {
  printf '%s\n' 'usage: install.sh [--dir <path>] [--main | --version <X.Y.Z>]' >&2
}

fail() {
  printf 'install: %s\n' "$*" >&2
  exit 1
}

refuse() {
  printf 'install: %s\n' "$*" >&2
  usage
  exit 2
}

dir="${ESBOZO_INSTALL_DIR:-$HOME/.local/bin}"
tag=""
version=""

while [ $# -gt 0 ]; do
  case "$1" in
    --dir)
      [ $# -ge 2 ] || refuse '--dir needs a folder'
      dir="$2"
      shift 2
      ;;
    --main)
      [ -z "$version" ] || refuse '--main and --version cannot be combined'
      tag=main
      shift
      ;;
    --version)
      [ $# -ge 2 ] || refuse '--version needs a version, like 0.1.0'
      [ -z "$tag" ] || refuse '--main and --version cannot be combined'
      case "$2" in
        [0-9]*.[0-9]*.[0-9]*) ;;
        *) refuse "--version wants X.Y.Z, not '$2'" ;;
      esac
      version="$2"
      shift 2
      ;;
    *)
      refuse "unknown argument '$1'"
      ;;
  esac
done

while [ "$dir" != / ] && [ "${dir%/}" != "$dir" ]; do
  dir="${dir%/}"
done

case "$(uname -s)" in
  Linux) os=linux ;;
  Darwin) os=darwin ;;
  *)
    fail "unsupported operating system '$(uname -s)': ez installs on Linux and macOS"
    ;;
esac

case "$(uname -m)" in
  x86_64 | amd64) arch=x64 ;;
  arm64 | aarch64) arch=arm64 ;;
  *)
    fail "unsupported architecture '$(uname -m)': ez installs on x64 and arm64"
    ;;
esac

asset="ez-$os-$arch.gz"

if [ -n "$version" ]; then
  release="$RELEASE_URL/download/v$version"
  target="Release v$version"
elif [ -n "$tag" ]; then
  release="$RELEASE_URL/download/$tag"
  target="Main build"
else
  release="$RELEASE_URL/latest/download"
  target="latest Release"
fi

if command -v curl >/dev/null 2>&1; then
  fetch() { curl -fsSL "$1" -o "$2"; }
elif command -v wget >/dev/null 2>&1; then
  fetch() { wget -q "$1" -O "$2"; }
else
  fail 'needs curl or wget to download ez'
fi

if command -v sha256sum >/dev/null 2>&1; then
  sha256() { sha256sum "$1" | cut -d' ' -f1; }
elif command -v shasum >/dev/null 2>&1; then
  sha256() { shasum -a 256 "$1" | cut -d' ' -f1; }
else
  fail 'needs sha256sum or shasum to check the download'
fi

mkdir -p "$dir" || fail "cannot create $dir"
[ -w "$dir" ] || fail "cannot write to $dir"

# A folder where `ez` goes takes the staged binary inside it and leaves the
# folder without an `ez`; an `esbozo` that is not a symlink gets `ez` linked
# inside it. Both are refused before anything is fetched.
if [ -d "$dir/ez" ]; then
  fail "$dir/ez is a folder: move it away and install again"
fi
if [ -e "$dir/esbozo" ] && [ ! -L "$dir/esbozo" ]; then
  fail "$dir/esbozo is not a symlink: move it away and install again"
fi

work=$(mktemp -d) || fail 'cannot make a temporary folder'
staged="$dir/.ez-install.$$"
trap 'rm -rf "$work"; rm -f "$staged"' EXIT INT TERM

fetch "$release/SHA256SUMS" "$work/SHA256SUMS" || fail "cannot download $release/SHA256SUMS"
# A sums line names the asset after two spaces, or after a `*` in binary mode,
# and one written on Windows ends in a CR. Both name the same asset.
expected=$(awk -v name="$asset" '
  { sub(/\r$/, "", $2); sub(/^\*/, "", $2) }
  $2 == name { print $1 }
' "$work/SHA256SUMS")
[ -n "$expected" ] || fail "$release/SHA256SUMS names no $asset"

fetch "$release/$asset" "$work/$asset" || fail "cannot download $release/$asset"
actual=$(sha256 "$work/$asset")
if [ "$actual" != "$expected" ]; then
  fail "checksum mismatch for $asset: the release says $expected, the download is $actual"
fi

gunzip -c "$work/$asset" >"$staged" || fail "cannot unpack $asset"
chmod 755 "$staged"

if [ -f "$dir/ez" ] && [ "$(sha256 "$dir/ez")" = "$(sha256 "$staged")" ]; then
  printf 'ez (%s) is already installed in %s; nothing to do\n' "$target" "$dir"
  exit 0
fi

mv -f "$staged" "$dir/ez"
ln -sfn ez "$dir/esbozo"
printf 'installed ez (%s) to %s/ez\n' "$target" "$dir"

case ":$PATH:" in
  *":$dir:"*) ;;
  *)
    printf 'add %s to PATH to run ez without the full path:\n' "$dir"
    printf '  export PATH="%s:$PATH"\n' "$dir"
    ;;
esac
