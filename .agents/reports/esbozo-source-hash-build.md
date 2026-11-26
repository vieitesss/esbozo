Verdict: PASS (build complete; all scoped gates green)
What changed: Added `data-source-hash="sha256:<hex>"` to every file-backed SVG written by esbozo (`ez render`, editor save, `ez serve`, and the `ez bundle` `<esbozo-editor>` embed), documented it in `docs/schema.md`, and verified against `overview.esbozo`.
Must-fix count: 0
Decisions needed: 0
Branch: `feat/source-hash` (5 green commits on top of `main` `8db8485`)
Attribute format: `data-source-hash="sha256:<64-char-lowercase-hex>"`
Bundle output: `ez bundle <dir>` writes `<dir>/esbozo-0.0.0.js` (`esbozo-<package.json version>.js`, 63,665 bytes gzipped)

## Attribute format

Every SVG written from a Scene file carries both attributes on the root `<svg>` element:
- `data-scene-hash="sha256:<hex>"` — unchanged; SHA-256 of canonical `serialiseScene(scene)`.
- `data-source-hash="sha256:<hex>"` — SHA-256 of the exact raw bytes of the `.esbozo` Scene file it was rendered from.

## SVG write paths

1. **`ez render` (`src/cli.ts` → `loadScene` + `runRender`)**: reads the `.esbozo` file as raw `Buffer` bytes (`readFile(scenePath)`), hashes those exact bytes with `sha256Hex(bytes)` (`src/sha256.ts`), and passes `sourceHash` to `renderScene(scene.value, layout.value, scene.sourceHash)`.
2. **Editor page, `ez serve`, and `ez bundle` embed (`src/editor/paint.ts` → `PaintCache.files`)**: all three share `PaintCache.files(scene)` → `Connection.#writeScene` (`src/editor/connection.ts`). `PaintCache.files` computes `hash = await sha256HexAsync(json)` (from `src/sha256.ts`, browser-safe, no `node:*` imports) over the exact `json` string being written/sent in `PUT { scene, svg }` and passes it to `sceneSvg(scene, hash, drawings, hash)`. Because the editor writes canonical `json`, `data-source-hash` matches both the `scene` payload sent in the `PUT` request and a subsequent `ez render` of that saved file.
3. **`ez serve` (`src/serve.ts` → `writePair`)**: writes `{ scene, svg }` received from the editor/embed verbatim; does not regenerate SVGs.
4. **In-memory renders without a file (`src/png.ts`, `src/editor/export.ts`, direct `renderScene(scene, layout)` calls)**: `sourceHash` is omitted, so `data-source-hash` is omitted from the `<svg>` tag.

## Embed bundle

- Command: `ez bundle <dir>`
- Output file: `<dir>/esbozo-0.0.0.js` (`<dir>/esbozo-<version>.js` from `package.json`).
- Verified in `test/embed-bundle.test.ts`: valid ESM module, 197,975 bytes raw / 63,665 bytes gzipped (under 64 KiB budget), includes `data-source-hash=` stamping, and has zero `node:*` imports (enforced by `tsconfig.browser.json` and `check-rules`).

## Choices made

- **Extended `sha256Hex` in `src/sha256.ts` to accept `string | Uint8Array`**: avoids adding a new export while allowing `src/cli.ts` to hash raw file `Buffer` bytes directly without UTF-8 re-encoding drift.
- **Omitted `data-source-hash` when `sourceHash` is not passed**: keeps in-memory PNG rasterisation (`src/png.ts`, `src/editor/export.ts`) and direct `renderScene(scene, layout)` calls clean and semantically accurate (no source file exists).
- **Did not add `data-source-hash` to `GLOSSARY.md`**: `GLOSSARY.md` defines canvas domain terms only (`Scene`, `Element`, `Label`, `Text`, `Snap`, `Grid`, etc.) and does not list `data-scene-hash` or SVG attributes.

## Gate commands and outputs

- `pnpm typecheck` (`tsc -p tsconfig.json && tsc -p tsconfig.browser.json && tsc -p tsconfig.test.json`): **PASS** (exit 0)
- `pnpm lint` (`oxlint --deny-warnings`): **PASS** (exit 0)
- `pnpm knip`: **PASS** (exit 0 — "Excellent, Knip found no issues.")
- `node --test test/paint.test.ts`: **PASS** (6/6 passed)
- `node --test test/embed-bundle.test.ts`: **PASS** (4/4 passed; bundle 63,665 bytes gzipped)
- `node --test --test-name-pattern="data-source-hash|fractional coordinate|corners on an ellipse|written labelAt|two-point shaft keeps" test/render.test.ts test/elements.test.ts test/curves.test.ts`: **PASS** (8/8 passed)
- `pnpm check:steps main`: **PASS** (exit 0 — all commits pass `typecheck`, `lint`, `knip`, `check-rules`)
- Scratch render of `/home/vieitesrpi/personal/sb/zett/assets/installation-script/overview.esbozo` (copied to `/tmp`): **PASS**
  - `sha256sum`: `sha256:35d557976bb90b862b3f81cd8c72b548e999d80c8551db80f0876e394e70b60e`
  - `data-source-hash`: `sha256:35d557976bb90b862b3f81cd8c72b548e999d80c8551db80f0876e394e70b60e`

## Pre-existing

- `test/probe.test.ts` (6 tests in full `pnpm test`): fails because Playwright Chromium browser binary is not installed in this environment (`Please run pnpm exec playwright install`); unrelated to this change.
