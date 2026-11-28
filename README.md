# esbozo

[![Latest Release](https://img.shields.io/github/v/release/vieitesss/esbozo)](https://github.com/vieitesss/esbozo/releases/latest)
[![check](https://github.com/vieitesss/esbozo/actions/workflows/ci.yml/badge.svg)](https://github.com/vieitesss/esbozo/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

A small canvas for hand-drawn diagrams, drawn by people and written by agents.

A diagram is a Scene, a JSON file named `<name>.esbozo` that you edit in a browser and an agent writes directly. The `ez` binary checks a Scene, renders it to an SVG that reads colours and font from CSS variables, exports light and dark PNGs, and serves the browser editor. Everything ships inside one static binary with no runtime dependencies.

## Install

Run the install script on Linux or macOS, x64 or arm64, without `sudo`:

```sh
curl -fsSL https://esbozo.vieitesss.eu/install | sh
```

The script verifies `SHA256SUMS` and installs the binary at `${ESBOZO_INSTALL_DIR:-$HOME/.local/bin}/ez` with an `esbozo` symlink beside it. Pass flags to `sh` to change the channel or install folder:

- Use `--main` to install the rolling Main build, as in `curl -fsSL https://esbozo.vieitesss.eu/install | sh -s -- --main`.
- Use `--version X.Y.Z` to install a specific Release, as in `curl -fsSL https://esbozo.vieitesss.eu/install | sh -s -- --version 0.1.0`.
- Use `--dir <path>` or set `ESBOZO_INSTALL_DIR` to choose another install folder.

Run `ez --help` to see every command, flag, and exit code.

## Update

Run `ez update` to replace the installed binary with the latest Release:

```sh
ez update
```

Pass `--main` to switch to the rolling Main build, or `--version X.Y.Z` to install a specific Release.

## Quick start

Follow these four steps to create, check, render, and edit a Scene:

1. Save this Scene as `flow.esbozo`:

   ```json
   {
     "version": 1,
     "title": "Orders flow",
     "elements": [
       { "id": "orders", "type": "rectangle", "x": 44, "y": 44, "width": 176, "height": 88, "label": "Orders" },
       { "id": "billing", "type": "rectangle", "x": 330, "y": 44, "width": 176, "height": 88, "label": "Billing" },
       {
         "id": "orders-billing",
         "type": "arrow",
         "points": [
           { "x": 132, "y": 88, "snap": "orders" },
           { "x": 418, "y": 88, "snap": "billing" }
         ]
       }
     ]
   }
   ```

2. Validate the Scene schema, Snaps, and Label fit. A clean Scene prints nothing:

   ```sh
   ez check flow.esbozo
   ```

3. Render the Scene to `flow.svg` beside the source file:

   ```sh
   ez render flow.esbozo
   ```

4. Serve the current folder in the browser editor, open the printed URL, and stop the server with Ctrl+C:

   ```sh
   ez serve .
   ```

## Agent skill

Install the bundled agent skill so coding agents learn the Scene schema and check-render loop:

```sh
ez skill install
```

This command writes `~/.agents/skills/esbozo/SKILL.md`. Pass `--dir <path>` to write `<path>/esbozo/SKILL.md`, or run `ez skill` to print `SKILL.md` to stdout.

## Docker

Before running the container, make sure the `diagrams` folder exists and is writable by uid 65532. Run the editor on that folder:

```sh
docker run --rm -p 127.0.0.1:4320:4320 -v "$PWD/diagrams:/scenes" ghcr.io/vieitesss/esbozo
```

Open `http://127.0.0.1:4320/` in your browser. Arguments after the image name pass to `ez serve`, such as `--read-only`. See [Docker](docs/docker.md) for Linux permissions, networking, and local image builds.

## Uninstall

```sh
rm -f "${ESBOZO_INSTALL_DIR:-$HOME/.local/bin}/ez" "${ESBOZO_INSTALL_DIR:-$HOME/.local/bin}/esbozo"
```

## Documentation

Read these pages for the full reference and contributor workflow:

- [Scene schema](docs/schema.md) lists every Scene key, Element type, and style option.
- [Save API](docs/save-api.md) describes `ez serve` flags, HTTP routes, and save guarantees.
- [Embedding the editor](docs/embed.md) explains how to embed `<esbozo-editor>` with `ez bundle`.
- [Docker](docs/docker.md) covers container permissions, networking, and local builds.
- [Architecture](docs/architecture.md) describes how Scene, Layout, Renderer, Editor, and `cmd/ez` fit together.
- [Development](docs/development.md) covers building from source, running tests, and contributing.
- [Glossary](GLOSSARY.md) defines the esbozo vocabulary.
