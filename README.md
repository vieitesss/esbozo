# esbozo

A small canvas for hand-drawn diagrams, drawn by people and written by agents.

A diagram is a **Scene**: a short JSON file that a person edits in a browser and an agent writes directly. The `ez` command checks a Scene, renders it to an SVG that takes its colours and font from the page's CSS variables (so one file fits light and dark), and renders it to a PNG so an agent can look at its own work.

Words used here (Scene, Element, Label, Text, Snap, Grid) are defined in [GLOSSARY.md](GLOSSARY.md).

## Install

Needs Node 22.22.3 or newer and pnpm. In a clone of this repository:

```sh
pnpm install && pnpm build
node dist/cli.js check scene.json
```

Everywhere below, `ez` stands for `node dist/cli.js` (or for the `ez` bin, if you link the package into your path). The npm package, which will make `npx esbozo <command>` and a global `ez` work, arrives with #13; until then neither command exists on the registry.

## Commands

`ez --help` is the reference for every command, flag, default and exit code.

| Command | What it does |
| --- | --- |
| `ez check <scene>` | Prints each problem as `<element id>: <message>` on stderr, and nothing when the Scene is clean. Reports schema errors, Snap ends that point nowhere, and Labels that do not fit. A font note (a remote `@font-face` replaced by the bundled font) is not a problem: it prints on stderr and the exit code stays `0`. |
| `ez render <scene>` | Writes `<name>.svg` beside the Scene and prints its path. The same Scene and the same font file give the same bytes. |
| `ez png <scene> --theme light\|dark` | Writes `<name>.<theme>.png` beside the Scene and prints its path. |
| `ez serve <dir>` | Serves the editor on a folder of Scenes, and a save API for them. Runs until stopped. See [The editor](#the-editor). |

Flags take a separate value: `--theme dark`, never `--theme=dark`.

## The Scene

Write a Scene by hand or by agent; [docs/schema.md](docs/schema.md) lists every key. An agent that has the Skill in [skills/esbozo/SKILL.md](skills/esbozo/SKILL.md) learns the schema and the loop: write, `ez check`, `ez png`, look, fix. The SVG and PNG are outputs; the Scene stays the only source.

Keys you leave out take the defaults in [docs/schema.md](docs/schema.md). The Skill spaces Elements in 22px steps, the spacing of the editor's Grid dots.

## The editor

The editor is a custom element, `<esbozo-editor>`, built into `dist/` with the CLI (`pnpm build`).

The way to use it is `ez serve`:

```sh
ez serve ./diagrams          # serving /abs/path/diagrams on http://127.0.0.1:4320/
ez serve ./diagrams --port 0 # let the system pick the port, and read it from the line it prints
ez serve ./diagrams --read-only
```

Open the printed URL in a browser. The page lists the folder's Scenes (top-level `*.json` files), opens the first, and every change saves the Scene and its SVG. `--read-only` shows the Scenes and saves nothing. The server listens on `127.0.0.1`, so only this machine reaches it; `--host` changes that, and nothing protects the folder from whoever then reaches it. Stop it with Ctrl+C. [docs/save-api.md](docs/save-api.md) holds the flags, the HTTP contract and what a save guarantees, for a client that is not the editor.

The page also works from any static host that serves `dist/`. Without `ez serve` behind it, the page needs a browser with the File System Access API (Chrome or Edge): open a folder, pick or create a Scene, and every change saves the Scene and its SVG back to that folder.

[docs/architecture.md](docs/architecture.md) explains how Scene, Layout, Renderer and Editor fit together.

## Licences

The code is MIT: see [LICENSE](LICENSE). The bundled font, Kalam, is under the SIL Open Font License: see [fonts/OFL.txt](fonts/OFL.txt).
