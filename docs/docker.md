# Docker

An image that runs `ez serve` on a mounted folder, so esbozo sits next to the other services on a machine. The image is `Dockerfile`; the build context is cut down by `.dockerignore`.

## Build

```sh
docker build -t esbozo .
```

That builds for the platform docker runs on. Both architectures need buildx, which the plain builder does not have:

```sh
docker buildx build --platform linux/amd64,linux/arm64 -t esbozo .
```

Add `--push` to send both to a registry, or `--load` for the current platform only (a multi-platform image exists in the builder's cache, not in the local image store). `.github/workflows/docker.yml` runs that command on pushes to `main` and on pull requests, keeping the layers in the GitHub Actions cache (`type=gha`), because a machine without buildx cannot check the other architecture itself.

The image's content is 78 MiB: `node:22-slim` (76 MiB) plus the built editor and CLI (`dist/`, 5.6 MB). That is what a registry stores. Docker's own disk usage is larger, 354 MB on this machine, because every layer counts, the base image's included. The runtime stage carries no application `node_modules`: esbuild inlines every dependency into `dist/cli.js`, roughjs, opentype and resvg's wasm included, so it copies `dist/` and the licence and nothing else. The `node_modules` the base image keeps for its own global npm and Corepack stay there. `test/bundle.test.ts` holds that split: it renders, draws a PNG and serves the page from a folder that holds `dist/` alone.

## Run

```sh
docker run --rm -p 127.0.0.1:4320:4320 -v "$PWD/diagrams:/scenes" esbozo
```

Open <http://127.0.0.1:4320/>. The folder has to exist already and be writable by the user the server runs as: [Writes and the user](#writes-and-the-user). What the image fixes, and what is left to the command line:

| | |
| --- | --- |
| Entrypoint | `node /app/dist/cli.js serve /scenes --host 0.0.0.0` |
| Volume | `/scenes` — the folder of Scenes |
| Port | `4320`, the CLI's default (`EXPOSE 4320`) |
| User | `node`, uid 1000 |

Everything after the image name appends to that command, so the flags are the CLI's own:

```sh
docker run --rm -p 127.0.0.1:4320:4320 -v "$PWD/diagrams:/scenes" esbozo --read-only
docker run --rm -p 127.0.0.1:8080:8080 -v "$PWD/diagrams:/scenes" esbozo --port 8080
```

A later `--host` wins over the one above, because `ez serve` reads the last one: `--host 127.0.0.1` binds the container's own loopback, which nothing outside it reaches.

## Where the folder is reachable

`ez serve` binds `127.0.0.1` by default, and a loopback inside a container is reachable from nowhere. The image therefore passes `--host 0.0.0.0`, which moves the decision to the network the container sits on:

- `-p 127.0.0.1:4320:4320` limits ingress from the host's network: no other machine there gets in, which is the reach `ez serve` has on its own.
- `-p 4320:4320` publishes every interface, so the host's network gets in too.

Neither flag limits the Docker network. The container is on it, and every other container on the same network reaches `0.0.0.0:4320` whatever the publish side says, because that traffic never leaves the network. There is no authentication on any of these paths, and the folder is writable by whoever arrives. So keep untrusted peers off that network, or, when they must reach the server, add `--read-only`:

```sh
docker network create esbozo
docker run --rm --network esbozo -p 127.0.0.1:4320:4320 -v "$PWD/diagrams:/scenes" esbozo
docker run --rm --network esbozo --read-only -p 127.0.0.1:4320:4320 -v "$PWD/diagrams:/scenes" esbozo
```

[docs/save-api.md](save-api.md) is the reference for the flags, the HTTP routes and what a save guarantees.

## Writes and the user

`/scenes` is a mount, and it has to be a directory that already exists and is writable by the user the server runs as. The image runs as `node`, uid 1000. A bind mount keeps the host folder's ownership instead of copying the image's, so the two agree only where Docker Desktop maps them (macOS, Windows); on a native Linux host they differ, and the container user cannot even read a folder of mode `0700`. Run it as the folder's owner there:

```sh
docker run --rm -p 127.0.0.1:4320:4320 --user "$(id -u):$(id -g)" -v "$PWD/diagrams:/scenes" esbozo
```

Mount a folder that is already there. `-v` on a path that does not exist creates it, owned by root and mode `0755`, so the container user cannot write it and neither can the host user. A write that does fail answers `500` with `EACCES` and the server keeps serving; a folder it cannot read stops it at startup.

A named volume starts out right instead, because Docker copies the mount point's owner from the image:

```sh
docker volume create esbozo-scenes
docker run --rm -p 127.0.0.1:4320:4320 -v esbozo-scenes:/scenes esbozo
```

## Tests

`pnpm test:docker` builds the image for the host platform and drives it: the listing, a save that lands in the mounted folder, `--read-only` answering `403` and writing nothing, and `--host` read from the last flag. Each container runs as the host user, so a folder of mode `0700` is mountable on Linux too. It is not part of `pnpm test`, because a first run builds the image. Without the `docker` command, or without a daemon answering it, the tests skip themselves and say which of the two it was.
