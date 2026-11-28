# Export

Export lets a user download a light or dark PNG of the open Scene from the command palette and produces images matching `ez png` and `ez render` on the same Scene file.

## Sub-features

- `export-png-light` downloads `<name>.light.png` from the command palette matching `ez png --theme light`.
- `export-png-dark` downloads `<name>.dark.png` matching `ez png --theme dark` with light ink on dark paper.
- `export-svg-sidecar` writes `<name>.svg` beside the saved Scene on every edit under `ez serve`.

## How to get to it (user POV)

- Press `q` (with focus outside an editable field) to open the `Commands` dialog.
- Choose `Export PNG (light)` or `Export PNG (dark)` from the command list.
- Alternatively, run `dist/ez png scene.esbozo --theme light` (or `--theme dark`) or `dist/ez render scene.esbozo` in a terminal.

## Driving it with pnpm probe

Preconditions:

- `pnpm build` succeeded.
- `$RUN_DIR` holds `scene.esbozo` containing at least one Element with text so embedded font rendering is exercised.
- `ez serve "$RUN_DIR" --port 0` is running and Doctor passed on `SERVE_URL`.

- **Open command palette.** Navigate to `SERVE_URL` and press `q`. A dialog with role `dialog` and name `Commands` becomes visible.
- **Download light PNG.** Register `const dl = page.waitForEvent('download')`, click `page.getByRole('option', { name: /Export PNG \(light\)/ })`, await `dl`, and save it to `.e2e/results/verify/<run>/scene.light.png`. The suggested filename is `scene.light.png`.
- **Download dark PNG.** Reopen the palette with `q`, trigger `Export PNG (dark)`, and save it to `.e2e/results/verify/<run>/scene.dark.png`. The suggested filename is `scene.dark.png` and its pixel bytes differ from the light PNG.
- **Compare with CLI output.** Run `dist/ez png "$RUN_DIR/scene.esbozo" --theme light`, `dist/ez png "$RUN_DIR/scene.esbozo" --theme dark`, and `dist/ez render "$RUN_DIR/scene.esbozo"`. Every command exits `0`, prints the output path, and the CLI PNG dimensions match the browser downloads.
- **Inspect exported ink.** Open the saved light and dark PNGs (and crop any text or arrow junction with `sips -c` if needed). Confirm the Kalam typeface rendered rather than a system fallback font.
- **Regression check.** Run `npx e2e run tests/editor-export.e2e.ts`. All export checks pass.

## Gotchas

- CLI flags take a separate value: `--theme dark`, never `--theme=dark`.
- A Scene without words will not catch a missing font in the rasterized SVG. Include a Label or Text Element when verifying PNG export.
- Browser and `resvg` antialias curves slightly differently, so compare pixel difference with a tolerance (see `difference` in `tests/pixels.ts`) rather than raw byte equality.
