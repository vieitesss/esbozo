#!/bin/sh
# The run inside the image `docker/e2e.Dockerfile` builds.
#
# `pnpm e2e:linux` mounts the worktree read-only at `/src`; this copies it over
# `/work`, where the image installed the dependencies from the lockfile. The
# excludes are the things the container must not inherit: the host's
# `node_modules` (macOS binaries, and the whole reason for the copy), git's
# checkout, and what an earlier run left in `dist` and `.e2e`.
#
# The arguments are `e2e run`'s own, so a file with a line, `--grep` and
# `--last-failed` mean what they mean locally; with none, it runs the model-free
# suite `pnpm e2e` names.
#
# `exec` hands the suite the container's process, so a terminal's Ctrl-C reaches
# it and not a wrapper's corpse: e2e cleans up and reports finish.
set -eu

tar -C /src \
  --exclude=./node_modules \
  --exclude=./.git \
  --exclude=./dist \
  --exclude=./.e2e \
  -cf /tmp/source.tar .
tar -C /work -xf /tmp/source.tar
rm /tmp/source.tar

if [ "$#" -eq 0 ]; then
  exec pnpm e2e
fi
pnpm build
exec pnpm exec e2e run "$@"
