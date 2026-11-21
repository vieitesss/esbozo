# esbozo

A small canvas for hand-drawn diagrams, drawn by people and written by agents.

A diagram is a **Scene**: a short file of JSON that a person edits in a browser and an agent writes directly. A Scene is named `<name>.esbozo`; a `<name>.json` file that holds one is a Scene as well, so existing diagrams keep their name. The `ez` command checks a Scene, renders it to an SVG that takes its colours and font from the page's CSS variables (so one file fits light and dark) and falls back to the light theme when there is no page around it, and renders it to a PNG so an agent can look at its own work.

Words used here (Scene, Element, Label, Text, Snap, Grid) are defined in [GLOSSARY.md](GLOSSARY.md).

## Install

Needs Node 22.22.3 or newer and pnpm. In a clone of this repository:

```sh
pnpm install && pnpm build
node dist/cli.js check scene.esbozo
```

Everywhere below, `ez` stands for `node dist/cli.js` (or for the `ez` bin, if you link the package into your path).

The package itself is not on the registry yet. `npm pack` builds the tarball — `prepack` runs `pnpm build` — and installing that tarball gives the `ez` and `esbozo` commands, so `npx esbozo --help` works from it. It carries the bundled CLI, the editor page and its assets, the one-file editor bundle `ez bundle` writes, and Kalam with its OFL licence.

## Commands

`ez --help` is the reference for every command, flag, default and exit code.

| Command | What it does |
| --- | --- |
| `ez check <scene>` | Prints each problem as `<element id>: <message>` on stderr, and nothing when the Scene is clean. Reports schema errors, Snap ends that point nowhere, and Labels that do not fit. A font note (a remote `@font-face` replaced by the bundled font) is not a problem: it prints on stderr and the exit code stays `0`. |
| `ez render <scene>` | Writes `<name>.svg` beside the Scene and prints its path. The same Scene and the same font file give the same bytes. A Scene is a `.esbozo` file, or a `.json` one that holds a Scene. |
| `ez png <scene> --theme light\|dark` | Writes `<name>.<theme>.png` beside the Scene and prints its path. |
| `ez serve <dir>` | Serves the editor on a folder of Scenes, and a save API for them. Runs until stopped. See [The editor](#the-editor). |
| `ez bundle <dir>` | Writes the editor as one ES module, `<dir>/esbozo-<version>.js`, for a page of your own. An existing file of that name is replaced, so a page pins it with a one-file diff. See [Embedding the editor](#embedding-the-editor). |

Flags take a separate value: `--theme dark`, never `--theme=dark`.

## The Scene

Write a Scene by hand or by agent; [docs/schema.md](docs/schema.md) lists every key. An agent that has the Skill in [skills/esbozo/SKILL.md](skills/esbozo/SKILL.md) learns the schema and the loop: write, `ez check`, `ez png`, look, fix. The SVG and PNG are outputs; the Scene stays the only source.

Keys you leave out take the defaults in [docs/schema.md](docs/schema.md). The Skill spaces Elements in 22px steps, the spacing of the editor's Grid dots.

## The editor

The editor is a custom element, `<esbozo-editor>`, built into `dist/` with the CLI (`pnpm build`).

The way to use it is `ez serve`:

```sh
ez serve ./diagrams          # serving /abs/path/diagrams on http://127.0.0.1:4320/ (build 1a2b3c4, 2024-06-01T12:34:56Z)
ez serve ./diagrams --port 0 # let the system pick the port, and read it from the line it prints
ez serve ./diagrams --read-only
```

Open the printed URL in a browser. The page lists the folder's Scenes (top-level `*.esbozo` files, plus the `*.json` files that hold a Scene), opens the first, and every change saves the Scene and its SVG. `--read-only` shows the Scenes and saves nothing. The server listens on `127.0.0.1`, so only this machine reaches it; `--host` changes that, and nothing protects the folder from whoever then reaches it. Stop it with Ctrl+C. [docs/save-api.md](docs/save-api.md) holds the flags, the HTTP contract and what a save guarantees, for a client that is not the editor.

The page also works from any static host that serves `dist/`. Without `ez serve` behind it, the page needs a browser with the File System Access API (Chrome or Edge): open a folder, pick or create a Scene, and every change saves the Scene and its SVG back to that folder.

## Embedding the editor

`ez bundle public/` writes the same editor as one file, `esbozo-0.0.0.js`, and a page of your own uses it with no esbozo page and no build step:

```html
<esbozo-editor
  scene="/sketches/flow.esbozo"
  save="/api/scenes/flow.esbozo"
  font="/fonts/Kalam-Regular.ttf"></esbozo-editor>
<script type="module" src="/esbozo-0.0.0.js"></script>
```

`scene` is a URL a `GET` answers the Scene's source on, `save` a URL a `PUT` takes `{ scene, svg }` on — the write [docs/save-api.md](docs/save-api.md) describes — and `font` the URL of the Kalam file the page draws and measures with, since the bundle never carries the font. Without `save` the editor is read-only and its status line says so; a `404` on `scene` opens an empty canvas that says `new Scene` and writes nothing until the first edit. The element is a 480px box in the page's content, every rule the bundle writes is rooted at it, and two elements on one page are two editors. [docs/embed.md](docs/embed.md) has the details: live attributes, the theme, the size, and what the bundle does and does not do.

[docs/architecture.md](docs/architecture.md) explains how Scene, Layout, Renderer and Editor fit together.

## Docker

To run `ez serve` next to other services instead of from a clone:

```sh
docker build -t esbozo .
docker run --rm -p 127.0.0.1:4320:4320 -v "$PWD/diagrams:/scenes" esbozo
```

Open <http://127.0.0.1:4320/>. `diagrams` must exist already and be writable by the container's user (uid 1000). Arguments after the image name are the CLI's own, so `esbozo --read-only` works. [docs/docker.md](docs/docker.md) has the Linux owner-matching run, the multi-arch build, the port, who can reach the server and `pnpm test:docker`.

## Licences

The code is MIT: see [LICENSE](LICENSE). The bundled font, Kalam, is under the SIL Open Font License: see [fonts/OFL.txt](fonts/OFL.txt).
