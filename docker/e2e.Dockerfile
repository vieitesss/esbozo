# syntax=docker/dockerfile:1

# The Linux the browser suite is proved on: `ubuntu:26.04`, the release CI's
# `ubuntu-latest` runs today, the Node `.node-version` pins for CI, and Chromium
# with the system libraries it needs. The base is bumped by hand when CI's image
# moves, so the two stay the same release.
#
# `pnpm e2e:linux` builds this image, tags it with a hash of everything here that
# goes into it, and reuses the tag while all of that holds still. The source is
# not in the image: the worktree is mounted at `/src` and copied over the
# dependencies at run time (`scripts/e2e-linux-container.sh`), so a source change
# costs a copy, and the host's macOS `node_modules` is masked out of the mount.
#
# `NODE_VERSION`, `PNPM_VERSION` and `GO_VERSION` have no defaults on purpose: a
# default here is a second place to bump, and the three numbers live in
# `.node-version`, `package.json` and `go.mod`.
#
# The worktree's own `pnpm build` also compiles `cmd/ez`, so the image carries
# the Go toolchain `go.mod` names, copied from its own image: a static binary
# needs nothing from Ubuntu's packages.
ARG GO_VERSION

FROM golang:${GO_VERSION} AS go

FROM ubuntu:26.04

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl git xz-utils libatomic1 \
 && rm -rf /var/lib/apt/lists/*

# Node from the release tarball rather than a base image tag, so the version is
# the one CI installs and not the newest image that happens to carry it.
ARG NODE_VERSION
ARG PNPM_VERSION
RUN set -eux; \
    if [ -z "${NODE_VERSION}" ] || [ -z "${PNPM_VERSION}" ]; then \
      echo "NODE_VERSION and PNPM_VERSION are required: run this through pnpm e2e:linux" >&2; \
      exit 1; \
    fi; \
    arch="$(dpkg --print-architecture)"; \
    case "$arch" in amd64) node_arch=x64 ;; arm64) node_arch=arm64 ;; \
      *) echo "no Node release for architecture $arch" >&2; exit 1 ;; \
    esac; \
    curl -fsSLO "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-${node_arch}.tar.xz"; \
    tar -xJf "node-v${NODE_VERSION}-linux-${node_arch}.tar.xz" -C /usr/local --strip-components=1 --no-same-owner; \
    rm "node-v${NODE_VERSION}-linux-${node_arch}.tar.xz"; \
    node --version; npm --version; \
    npm install -g "pnpm@${PNPM_VERSION}"; pnpm --version

COPY --from=go /usr/local/go /usr/local/go
ENV PATH=/usr/local/go/bin:${PATH}

# Where `e2e-web install` puts Chromium, and the user the suite runs as: nobody
# draws as root, and Chromium refuses its sandbox as root.
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN useradd --create-home --shell /bin/bash builder \
 && mkdir -p /work /ms-playwright \
 && chown builder:builder /work /ms-playwright

# The dependencies, from the lockfile alone. `/work` is the folder a run copies
# the worktree into, so what the image installs has to be all that is in it —
# and it has to belong to `builder`, or the copy cannot overwrite the manifests.
WORKDIR /work
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile && chown -R builder:builder /work

# The browser the suite launches, with its libraries, installed here so a run
# never pays for it.
RUN pnpm exec e2e-web install chromium --with-deps \
 && chown -R builder:builder /ms-playwright

USER builder
