---
name: verify-esbozo
description: Verify esbozo editor UI, rendered ink, CLI output, and real browser input (IME, CPU throttling) against a live build. Use when proving a fix or feature in the live editor, inspecting cropped 1x and zoomed ink, serving a folder of Scenes, or reproducing a visual regression.
---

# Verify esbozo

Drive the real esbozo web editor (`<esbozo-editor>`) and `ez` CLI against a fresh build, inspect the rendered ink at 1x and 800% zoom, and keep the proof. Read [features/README.md](features/README.md) before driving a mapped feature, then follow that feature's file.

## Launch

Build first. Neither `pnpm probe` nor `ez serve` builds for you.

```sh
pnpm build
```

Pick one of two run modes depending on what you are verifying.

### Mode A: single-run probe (`pnpm probe`)

Use `pnpm probe` for fast live-editor checks. It serves `dist/editor.html` on an ephemeral loopback port, launches headless Chromium at 1280x800, runs your probe module, prints its JSON return value on stdout, and closes both browser and server on exit.

```sh
pnpm probe path/to/probe.mjs
pnpm probe --folder /path/to/other/dist path/to/probe.mjs
pnpm probe <<'EOF'
export default async function ({ page, url, cdp }) {
  return { url, title: await page.title() };
}
EOF
```

`pnpm probe` prints `probing http://127.0.0.1:<port>/editor.html` on stderr when ready.

For Node-only module checks (no Chromium, no build needed), use `pnpm probe:node [probe.mjs]` or pipe source on stdin; its default export receives `loadProjectModules()` (`parseScene`, `drawnGeometry`, `snapTarget`, `Rail`, `Hand`, `Exits`, etc.) and any non-`undefined` return value prints as JSON on stdout:

```sh
pnpm probe:node <<'EOF'
export default async ({ parseScene, elementsById, drawnGeometry, createLayout, parseFontFile, KALAM }) => {
  const parsed = parseScene('{"version":1,"elements":[{"id":"a","type":"ellipse","x":10,"y":20,"width":100,"height":60}]}');
  if (!parsed.ok) throw new Error('invalid scene');
  const layout = createLayout(parseFontFile(KALAM));
  return drawnGeometry(parsed.scene.elements[0], elementsById(parsed.scene.elements), layout).box;
};
EOF
```

### Mode B: real folder server (`ez serve`)

Use `ez serve` when the editor must open, edit, and save real `.esbozo` or `.json` Scene files on disk, or when you want to verify `GET`/`PUT` persistence alongside the UI. Create a disposable folder with the `esbozo-` prefix so it matches `test/temp.ts`.

```sh
RUN_DIR="$(mktemp -d "${TMPDIR:-/tmp}/esbozo-verify-XXXXXX")"
dist/ez serve "$RUN_DIR" --port 0 >"$RUN_DIR/serve.log" 2>&1 &
SERVE_PID=$!
```

Wait until `$RUN_DIR/serve.log` prints the startup line, then export the slashless origin:

```text
serving /abs/path/... on http://127.0.0.1:<port>/ (build <sha>, <iso-utc>)
```

```sh
while ! grep -q 'http://127\.0\.0\.1:' "$RUN_DIR/serve.log"; do sleep 0.1; done
export SERVE_URL="$(sed -n 's|.*\(http://127\.0\.0\.1:[0-9]*\).*|\1|p' "$RUN_DIR/serve.log" | head -n 1)"
export RUN_DIR
```

Strip the trailing slash from the printed URL so `"${SERVE_URL}/api/health"` never sends `//api/health`, which returns HTTP 404. Pass `--read-only` to verify read-only mode. Never serve on a fixed port: `pnpm serve:editor` takes `4319`, which belongs to the person's own try-server, so an agent always serves with `--port 0`. Two `ez serve --port 0` instances with separate `$RUN_DIR` folders run side by side without conflict.

## Doctor

Run this read-only check before driving `ez serve` or whenever a run looks stale.

```sh
ls -l dist/ez dist/editor.html
curl -fsS "${SERVE_URL}/api/health"
curl -fsS "${SERVE_URL}/api/scenes"
```

On older commits that predate `/api/health` (such as `d2d280c`), `/api/health` returns HTTP 404. Fall back to `curl -fsS "${SERVE_URL}/api/scenes"` and confirm the folder name and Scene list match `$RUN_DIR`.

Confirm three facts before driving:

1. `dist/ez` and `dist/editor.html` exist and match the commit you built.
2. `/api/health` returns `{"build":"<sha>","builtAt":"<iso-utc>"}` matching the `SERVE_PID` startup line.
3. `/api/scenes` lists the disposable `$RUN_DIR` folder name and seeded Scene files.

Never drive a server whose `/api/health` build or folder does not match the instance you started.

## Drive

### Live probes (`{ page, url, cdp }`)

A probe module exports a default async function receiving `{ page, url, cdp }`:

- `page` is the Playwright page opened at 1280x800 on `editor.html`. Navigate to `SERVE_URL` with `await page.goto(serveUrl, { waitUntil: 'load' })` to drive a real `ez serve` folder.
- `url` is the `editor.html` URL `pnpm probe` opened.
- `cdp()` returns a fresh CDP session on `page`.

When piping a probe via stdin, `scripts/probe-editor.mjs` runs it from a temporary `$TMPDIR/esbozo-probe-*` folder. Import repository helpers using `pathToFileURL(resolve('tests/pixels.ts')).href` rather than a relative path.

Prefer ARIA roles, accessible names, and keyboard shortcuts over CSS selectors or DOM inspection. Wait for painted frames with two `requestAnimationFrame` ticks after pointer or keyboard input.

### Targeted e2e runs

For fast inner-loop checks on existing browser specs after `pnpm build`, filter a single file or test:

```sh
npx e2e run tests/editor-select.e2e.ts:177
npx e2e run tests/labels-edit.e2e.ts --grep 'arrow'
npx e2e run --last-failed
```

### Real browser input (IME and CPU throttling)

Synthetic DOM events (`compositionstart`, `compositionend`) do not trigger Chromium's real composition state, and unthrottled runs hide slow-CPU stalls.

- In `tests/*.e2e.ts`, use `tests/cdp.ts` (`imeCompose`, `imeCommit`, `throttleCpu`, `stillCaret`, `cursorAt`, `livePage`). Run `npx e2e run tests/labels-ime.e2e.ts` for IME, and `ESBOZO_TIMING=1 npx e2e run tests/cdp.e2e.ts` or `ESBOZO_TIMING=1 npx e2e run tests/editor-select.e2e.ts --grep 'reads the ink'` for opt-in median timing checks.
- In a `pnpm probe` run, open `const session = await cdp()` and call `Input.imeSetComposition`, `Input.insertText`, or `Emulation.setCPUThrottlingRate`. Always reset throttling to `rate: 1` before returning.

### CI-only Linux failures

Linux container e2e runs (`pnpm e2e:linux`) are tracked in issue #45 and are not built yet.

## Evidence

Save every proof file under `.e2e/results/verify/<run>/` (already gitignored). Name files by feature, commit or state, and zoom level, for example `.e2e/results/verify/issue-27/before-d2d280c-1x.png` and `.e2e/results/verify/issue-27/after-5418292-800pct.png`.

Proof standards:

- Drive the real user path (pointer, keyboard, rail buttons, command palette, or `ez` CLI), never internal setters.
- Capture both the action result on screen and any side effect on disk (the saved `.esbozo` or `.json` file, generated `.svg`, and `dist/ez check <file>` exit code).
- Inspect rendered ink at 1x and at 800% zoom (four `page.mouse.wheel(0, -400)` calls or `Meta+=`, plus a tight crop around the changed Element).
- Crop directly in Playwright with `await page.screenshot({ path, clip: { x, y, width, height } })`, or crop an existing PNG on macOS with `sips -c <height> <width> --cropOffset <top> <left> <in.png> --out <out.png>`.

Check the rendered ink the way a person does:

1. **Border hit area.** Click along the drawn stroke of an unfilled Element, including where roughness pushes ink outside the stored box, at 1x and 800% zoom. Confirm the Element selects, and confirm a click on bare paper clear of the ink selects nothing.
2. **Arrow tip and head.** Zoom in to 800% on the end of a drawn or Snapped arrow. Confirm the shaft meets the arrowhead cleanly with no overshoot past the tip.
3. **Label clearance.** Inspect Labels on boxes and on arrow shafts at 1x and 800% zoom. Confirm the words clear the shaft and head, and confirm an arrow Label has no opaque background box behind it.

## Cleanup

Stop only the processes this run started, using their recorded PIDs. Never kill by process name. Remove only disposable `$TMPDIR/esbozo-*` folders and detached worktrees created for the run.

```sh
kill "$SERVE_PID" && wait "$SERVE_PID" 2>/dev/null || true
rm -rf "$RUN_DIR"
```

Cleanup never deletes `.e2e/results/verify/`. Confirm your proof files still exist there after teardown.

## Helpers

Reuse the repository's existing verification modules instead of writing one-off scripts in `/tmp`:

- `scripts/probe-editor.mjs` is the `pnpm probe` runner.
- `tests/cdp.ts` provides `imeCompose`, `imeCommit`, `throttleCpu`, `stillCaret`, `cursorAt`, and `livePage`.
- `tests/pixels.ts` decodes PNG screenshots and measures dark ink bounds and pixel deltas.
- `tests/helpers.ts` and `tests/README.md` document the shared Scene fixtures, view coordinates, and CLI comparison helpers (`cliRender`, `cliPng`, `cliCheck`).

## Feature map

Read [features/README.md](features/README.md) for the baseline preconditions and index of mapped features:

- [Select by border](features/select-by-border.md)
- [Draw an arrow](features/draw-arrow.md)
- [Edit a Label](features/edit-label.md)
- [Export](features/export.md)
