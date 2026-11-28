# syntax=docker/dockerfile:1

# The image: `ez serve` on a mounted folder of Scenes.
ARG GO_VERSION=1.25.5

FROM golang:${GO_VERSION} AS go

FROM node:22-slim AS build

COPY --from=go /usr/local/go /usr/local/go
ENV PATH=/usr/local/go/bin:${PATH}

# Go on Linux builds its root pool from files alone, and `node:22-slim` carries
# no `/etc/ssl` at all, so `go build` cannot verify proxy.golang.org and stops
# with "x509: certificate signed by unknown authority". The `go` stage has the
# bundle; the toolchain copy above does not take it.
COPY --from=go /etc/ssl/certs /etc/ssl/certs

# The pnpm this repository's lockfile was written with: corepack would stop and
# ask for a version otherwise. Bump both together.
ARG PNPM_VERSION=11.24.0
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable && corepack prepare "pnpm@${PNPM_VERSION}" --activate

WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# esbuild reads `tsconfig.json` for the files it builds, and one compiler option
# in it (`verbatimModuleSyntax`) changes the bytes it writes.
COPY tsconfig.json tsconfig.base.json ./
RUN pnpm install --frozen-lockfile

COPY scripts ./scripts
COPY src ./src
COPY fonts ./fonts
COPY go.mod go.sum *.go ./
COPY cmd ./cmd
COPY skills ./skills
COPY internal ./internal
# What `ez --version` prints. `pnpm build` asks `.git` for it, and the context
# carries no `.git`, so the workflow that builds the image says it instead:
# `ESBOZO_RELEASE=1` on a Release tag, and the commit a Main build is stamped
# with. Both empty is a build nobody named, which stamps `unknown`.
ARG ESBOZO_RELEASE=
ARG ESBOZO_COMMIT=
RUN pnpm build

# The folder the Scenes live in, owned by the user the server runs as, so a
# named volume starts out writable instead of root-owned. It is made here
# because the runtime stage has no shell to run `mkdir` in; `COPY --chown`
# takes the ownership it is given rather than the build user's.
RUN mkdir -p /scenes

# The runtime: `gcr.io/distroless/static-debian12:nonroot` holds `/app/ez` and
# nothing runs beside it. `ez` is a static binary (`CGO_ENABLED=0`) and `ez
# serve` speaks plain HTTP and reads files, so it needs no libc and no CA
# bundle. What the base does buy: the `nonroot` user (uid 65532), the
# `/etc/passwd` that `ez skill install` reads through `os/user`, and `/tmp`.
FROM gcr.io/distroless/static-debian12:nonroot AS runtime

ENV ESBOZO_DOCKER=1
WORKDIR /app
COPY --from=build /app/dist/ez ./ez
COPY LICENSE ./
COPY --from=build --chown=65532:65532 /scenes /scenes

# Nobody draws as root inside the container. The base's `nonroot` is uid 65532;
# spelling it out keeps that true if the tag's user ever moves.
USER 65532:65532

VOLUME ["/scenes"]
EXPOSE 4320

# The CLI binds 127.0.0.1 by default, and no published port can reach a
# loopback inside the container, so the image passes the container's own
# address. What follows the image name appends here, so `docker run … --read-only`
# keeps this host; a later `--host` wins, because `ez serve` reads the last one.
ENTRYPOINT ["/app/ez", "serve", "/scenes", "--host", "0.0.0.0"]
