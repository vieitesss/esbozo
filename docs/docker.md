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

Add `--push` to send both to a registry, or `--load` for the current platform only (a multi-platform image exists in the builder's cache, not in the local image store). `.github/workflows/docker.yml` runs exactly that command on every push and pull request, because a machine without buildx cannot check the other architecture itself.

The image is 78 MiB uncompressed: `node:22-slim` (76 MiB) plus the built editor and CLI (`dist/`, 5.6 MB), and no `node_modules`. esbuild inlines every dependency into `dist/cli.js`, roughjs, opentype and resvg's wasm included, so the runtime stage copies `dist/` and the licence and nothing else. `test/bundle.test.ts` holds that split: it renders, draws a PNG and serves the page from a folder that holds `dist/` alone.

## Run

```sh
docker run --rm -p 127.0.0.1:4320:4320 -v "$PWD/diagrams:/scenes" esbozo
```

Open <http://127.0.0.1:4320/>. What the image fixes, and what is left to the command line:

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

`ez serve` binds `127.0.0.1` by default, and a loopback inside a container is reachable from nowhere. The image therefore passes `--host 0.0.0.0`, which leaves the decision that matters to the publish side of `docker run`:

- `-p 127.0.0.1:4320:4320` serves this machine only, the same reach as running `ez serve` on the host.
- `-p 4320:4320` publishes every interface. There is no authentication, and the folder is writable by whoever can reach it: add `--read-only` when it should not change.

[docs/save-api.md](save-api.md) is the reference for the flags, the HTTP routes and what a save guarantees.

## Writes and the user

The server runs as `node` (uid 1000), and a bind mount keeps the host folder's own ownership. When the host user is not uid 1000, a write fails with `EACCES`: run the container as the folder's owner, `--user "$(id -u):$(id -g)"`, or give the folder to uid 1000. A named volume starts out right, because Docker copies the mount point's owner from the image:

```sh
docker volume create esbozo-scenes
docker run --rm -p 127.0.0.1:4320:4320 -v esbozo-scenes:/scenes esbozo
```

## Tests

`pnpm test:docker` builds the image for the host platform and drives it: the listing, a save that lands in the mounted folder, `--read-only` answering `403` and writing nothing, and `--host` read from the last flag. It is not part of `pnpm test`, because a first run builds the image. Without a running docker it skips itself and says why.
