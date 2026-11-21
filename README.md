# esbozo

A small canvas for hand-drawn diagrams, drawn by people and written by agents.

A diagram is a **Scene**: a short JSON file that a person edits in a browser and an agent writes directly. The `ez` command checks a Scene, renders it to an SVG that takes its colours and font from the page's CSS variables (so one file fits light and dark), and renders it to a PNG so an agent can look at its own work.

Words used here (Scene, Element, Label, Text, Snap, Grid) are defined in [GLOSSARY.md](GLOSSARY.md).

## Install

Needs Node 22.22.3 or newer.

```sh
npm install --global esbozo   # installs `ez` and `esbozo`
npx esbozo check scene.json   # or run without installing
```

From a clone: `pnpm install && pnpm build`, then `node dist/cli.js <command>`.

## Commands

`ez --help` prints the usage of every command and the exit codes.

| Command | What it does |
| --- | --- |
| `ez check <scene>` | Prints each problem as `<element id>: <message>` on stderr, and nothing when the Scene is clean. Reports schema errors, Snap ends that point nowhere, and Labels that do not fit. |
| `ez render <scene>` | Writes `<name>.svg` beside the Scene and prints its path. The same Scene gives the same bytes. |
| `ez png <scene> --theme light\|dark` | Writes `<name>.<theme>.png` beside the Scene and prints its path. |
| `ez serve <dir>` | Serves the editor on a folder of Scenes, and a save API for them. Runs until stopped. See [The editor](#the-editor). |

Options: `--font <file>` (measure and draw with this font instead of the bundled Kalam), `--css <stylesheet>` (take colours and font from a site's stylesheet; `check` and `png`), `--ink`, `--paper` and `--muted` (colours for `png`). Flags take a separate value: `--theme dark`.

`ez serve` takes `--host <address>` (default `127.0.0.1`), `--port <N>` (default `4320`; `0` picks a free port) and `--read-only`.

Exit codes: `0` success, `2` wrong arguments, `3` the Scene cannot be read or parsed, `4` the output cannot be written or the server cannot start, `5` a missing theme value or font, `6` a Label does not fit its Element.

## The Scene

Write a Scene by hand or by agent; [docs/schema.md](docs/schema.md) lists every key. An agent that has the Skill in [skills/esbozo/SKILL.md](skills/esbozo/SKILL.md) learns the schema and the loop: write, `ez check`, `ez png`, look, fix. The SVG and PNG are outputs; the Scene stays the only source.

What a Scene draws when you leave keys out: Labels centre in their Elements, Text starts at its `x`, nothing is filled, and the Skill spaces everything in 22px steps, the editor's Grid.

## The editor

The editor is a custom element, `<esbozo-editor>`, built into `dist/` with the CLI (`pnpm build`).

The way to use it is `ez serve`:

```sh
ez serve ./diagrams          # serving /abs/path/diagrams on http://127.0.0.1:4320/
ez serve ./diagrams --port 0 # let the system pick the port, and read it from the line it prints
ez serve ./diagrams --read-only
```

Open the printed URL in a browser. The page lists the folder's Scenes (top-level `*.json` files), opens the first, and every change saves the Scene and its SVG together. `--read-only` shows the Scenes and saves nothing. The server listens on `127.0.0.1`, so only this machine reaches it; `--host` changes that, and nothing protects the folder from whoever then reaches it. Stop it with Ctrl+C. [docs/save-api.md](docs/save-api.md) is the HTTP contract, for a client that is not the editor.

The page also works from any static host that serves `dist/`. Without `ez serve` behind it, the page needs a browser with the File System Access API (Chrome or Edge): open a folder, pick or create a Scene, and every change saves the Scene and its SVG back to that folder.

[docs/architecture.md](docs/architecture.md) explains how Scene, Layout, Renderer and Editor fit together.

## Licences

The code is MIT: see [LICENSE](LICENSE). The bundled font, Kalam, is under the SIL Open Font License: see [fonts/OFL.txt](fonts/OFL.txt).
