#!/bin/sh
# The Release a run publishes: the tag its assets and image go under, and the
# stamp its `ez --version` carries.
#
# Both publishers ask this one script — `release.yml` for the four assets,
# `docker.yml` for the image — so a `vX.Y.Z` tag that names another version than
# `package.json` fails the same way in both, before either publishes anything of
# it. A tag push is the Release; everything else is the rolling Main build, and a
# pull request publishes nothing either way.
#
# Writes `version`, `tag` and `stamp` to `$GITHUB_OUTPUT`; `stamp` is `release`
# for a tag and `main` for everything else.
set -eu

version=$(node -p 'require("./package.json").version')

case "${GITHUB_EVENT_NAME:?}" in
  push)
    if [ "v$version" != "${GITHUB_REF_NAME:?}" ]; then
      printf 'release: %s is not package.json value v%s\n' "$GITHUB_REF_NAME" "$version" >&2
      exit 1
    fi
    tag="$GITHUB_REF_NAME"
    stamp=release
    ;;
  *)
    tag=main
    stamp=main
    ;;
esac

printf 'version=%s\ntag=%s\nstamp=%s\n' "$version" "$tag" "$stamp" >>"${GITHUB_OUTPUT:?}"
