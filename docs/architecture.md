# Architecture

esbozo has four modules behind small interfaces, and three programs built from them: the `ez` CLI, the editor page, and the editor bundle (the same element, for a page of someone else's). None imports another's code; they share only `src/paths.ts` and `src/scenes-api.ts` (file names, and the save API's routes, listing shape and write body). The words are defined in [GLOSSARY.md](../GLOSSARY.md).

## The four modules

**Scene** (`src/scene.ts`) is the schema. `parseScene(source)` returns a resolved Scene or a list of problems, each with an Element id. Every Element in a parsed Scene carries its own style and seed, so nothing downstream reads the defaults again. `serialiseScene` writes the canonical text (stable key order, whole-pixel geometry), and `hashScene` hashes it. It depends on nothing but `sha256.ts`. The keys are listed in [schema.md](schema.md).

**Layout** (`src/layout.ts`) is the words. Given the bytes of a font, it measures a line, wraps a Label, and places words inside an Element (`text` for a Text's own lines, `label` for the words beside or inside everything else). It says what does not fit (`overflow`) and how far an Element would have to grow (`grow`). It reads font bytes and never a file, so it runs in Node and in the browser. It depends on Scene's types.

**Renderer** (`src/renderer.ts`, with the outline maths in `src/geometry.ts`) turns a Scene and a Layout into an SVG string. It is pure: the same Scene measured with the same font file gives the same bytes. Rough.js draws the hand-made paths, each Element with its own seed. Colours and font are CSS variables (`--ink`, `--paper`, `--muted`, `--font-hand`), each written with the light theme's value as its own fallback so a saved SVG opened with no stylesheet around it still draws; the grey steps are fixed mixes of ink into paper, and the SVG carries the Scene hash and a title. It resolves each Snapped end onto its target's outline. It depends on Scene and Layout.

**Editor** (`src/editor/`) is the `<esbozo-editor>` custom element. It holds the Scene in memory, paints it with the Renderer, and turns pointer and keyboard input into Scene changes. It saves the Scene and its SVG through the folder interface in `src/editor/files.ts`, which has three implementations: a picked folder, a folder served by `ez serve` (`server-folder.ts`), and the one Scene two URLs name (`scene-url.ts`, the bundle's). It depends on Scene, Layout and Renderer, and on the two shared files above; it imports nothing from the CLI.

Each module depends only on the ones before it:

- Scene: nothing.
- Layout: Scene.
- Renderer: Scene and Layout.
- Editor: Scene, Layout and Renderer.
- CLI: Scene, Layout and Renderer, plus font, stylesheet, PNG and server code the editor never loads. It imports nothing from `src/editor/`.

Nothing depends backwards: Scene knows nothing of rendering, Layout knows nothing of SVG, and the Renderer knows nothing of a browser or a file.

The CLI and the editor meet only at run time, in one place: `ez serve` reads the editor's built page files (`editor.html`, `editor.css`, `editor.js` and the font) from beside `dist/cli.js` and sends them to a browser. It never loads that code itself. If those files are missing, `serve` exits `4`.

## One font, three readers

The Renderer, `ez check` and the editor agree on where words break and whether they fit because they all ask Layout, with the same font. In the CLI, `src/font.ts` picks the bytes: `--font`, then a local `@font-face` in the `--css` stylesheet, then the bundled Kalam. In the editor, `src/editor/main.ts` fetches the font the page draws with and measures that; the bundle fetches the font its `font` attribute names. The SVG names a family (`var(--font-hand, 'Kalam', 'Bradley Hand', 'Segoe Print', cursive)`) and never embeds a font.

Those bytes are read twice, because the two readers have different jobs. The CLI uses `opentype.js` (`parseFontFile`), which also names the family and counts the glyphs. The browser cannot afford it: it is bigger than the whole bundle is allowed to be. So `src/font-metrics.ts` reads the four tables Layout needs — `head`, `hhea`, `OS/2`, `hmtx` — and the character map, and nothing else. It sums advances the way `opentype.js` does, in the same order, so both readers give the same numbers to the last bit; `test/font-metrics.test.ts` holds them together on Kalam and on fonts the suite builds. It does not apply kerning, which Kalam has none of.

## The CLI

`src/cli.ts` reads arguments and files and calls the modules. `render` parses, loads a Layout and writes the SVG beside the Scene. `check` parses, loads a Layout and asks it about every Element. `png` renders the SVG, resolves its CSS variables to colours (`src/css.ts`, because resvg has no CSS engine), and rasterises it with resvg-wasm (`src/png.ts`). `serve` (`src/serve.ts`) listens on one folder of Scenes, answers the save API ([save-api.md](save-api.md)) and serves the editor page's files from beside the CLI (`src/page-assets.ts`); the editor finds that API (`src/editor/server-folder.ts`) and works on the folder without the browser's picker. `bundle` copies the built editor bundle out as `<dir>/esbozo-<version>.js`, named after the version in `package.json` ([embed.md](embed.md)). Exit codes are defined once, in `EXIT` in `src/cli.ts`.

## Builds

`pnpm build` (`scripts/build.mjs`) bundles three artefacts with esbuild from the same sources: `dist/cli.js` (Node, with Kalam and the resvg WASM embedded), `dist/editor.js` with the page, stylesheet and font beside it in `dist/`, and `dist/embed.js`, minified and carrying the stylesheet, which `ez bundle` copies out. The page's stylesheet is `font-face.css`, then `editor.css` — the editor's own rules, every one of them rooted at `esbozo-editor`, so the same text can be dropped into someone else's page — and then `page.css`, the served page's chrome: the window the editor fills and its light/dark switch. The page links that one file, and the bundle writes its own `@font-face` and element-scoped family for the `font` attribute's URL. The package `files` list ships `dist`, `fonts` and `skills`; `npm pack` runs `prepack`, which builds.

## Tests

Tests check behaviour from outside. `test/*.test.ts` run the CLI on Scene files in temporary folders under `node:test` (`pnpm test`). They reach Scene, Layout and Renderer through the commands. `tests/*.e2e.ts` drive the built editor in a browser and assert on what it saves (`pnpm e2e`); `tests/README.md` explains the browser suites.
