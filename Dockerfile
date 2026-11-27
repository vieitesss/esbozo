# syntax=docker/dockerfile:1

# The image: `ez serve` on a mounted folder of Scenes.
#
# Two stages, because the runtime needs the binary and nothing else. `ez` is one
# static file: the core, the page, the font and resvg's wasm are embedded in it
# by `assets.go`, so the second stage carries no `node_modules` and no `dist/`.
# `test/bundle.test.ts` holds that split honest: it renders, draws a PNG and
# serves the page from a folder that holds `ez` alone.
#
# `pnpm build` ends with `go build ./cmd/ez`, so the build stage carries the Go
# toolchain `go.mod` names, copied from its own image rather than downloaded
# here.
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
# `assets.go` embeds the skill `ez skill` prints, so `go build` fails without it.
COPY skills ./skills
COPY internal ./internal
RUN pnpm build


FROM node:22-slim AS runtime

ENV NODE_ENV=production
# What `ez update` reads to refuse here: a container's install is the image, so an
# update prints the `docker pull` line instead of writing into this container.
ENV ESBOZO_DOCKER=1
WORKDIR /app
# Only the binary `pnpm build` wrote: the core, the page and its compressed
# variants, the font and resvg's wasm are all embedded in it.
COPY --from=build /app/dist/ez ./ez
COPY LICENSE ./

# The folder the Scenes live in, owned by the user the server runs as, so a
# named volume starts out writable instead of root-owned.
RUN mkdir -p /scenes && chown node:node /scenes

# Nobody draws as root inside the container.
USER node

VOLUME ["/scenes"]
EXPOSE 4320

# The CLI binds 127.0.0.1 by default, and no published port can reach a
# loopback inside the container, so the image passes the container's own
# address. What follows the image name appends here, so `docker run … --read-only`
# keeps this host; a later `--host` wins, because `ez serve` reads the last one.
ENTRYPOINT ["/app/ez", "serve", "/scenes", "--host", "0.0.0.0"]
