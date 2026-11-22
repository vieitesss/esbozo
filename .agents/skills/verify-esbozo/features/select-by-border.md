# Select by border

Selecting by border lets a user click any visible stroke of an unfilled Element, including where hand-drawn roughness puts ink outside the Element's stored box, while a click on bare paper still selects nothing.

## Sub-features

- `border-1x` selects an unfilled rectangle, ellipse, or diamond by clicking its outermost drawn stroke at 1x zoom.
- `border-zoomed` selects the same Element by clicking its drawn stroke after zooming in.
- `border-miss` leaves the selection empty when clicking bare paper clear of the drawn stroke.

## How to get to it (user POV)

- Open a Scene containing unfilled Elements in the editor (with the Select tool active by default, or press `v` to return to Select).
- Click directly on the drawn stroke of an Element's border, then press `Shift+ArrowRight` to confirm selection by nudging it 10 units right.
- Zoom in with the mouse wheel or `Meta+=`, then click the drawn stroke again.

## Driving it with pnpm probe

Preconditions:

- `pnpm build` succeeded in the checkout under test.
- `$RUN_DIR` holds `borders.esbozo` with unfilled rectangle, ellipse, and diamond Elements at `roughness: 1` (for example `{ "version": 1, "title": "Borders", "defaults": { "roughness": 1 }, "elements": [{ "id": "rect", "type": "rectangle", "x": 40, "y": 40, "width": 120, "height": 80 }] }`).
- `ez serve "$RUN_DIR" --port 0` is running and Doctor passed on `SERVE_URL`.

- **Open the Scene.** Navigate `page` to `SERVE_URL` inside `pnpm probe` and wait for `load` plus two animation frames. The unfilled Element appears on paper at 1x zoom.
- **Find drawn border ink.** Scan a horizontal strip across the left edge of the Element's rendered pixels (or read the outermost dark pixel with `tests/pixels.ts` `decodePng`) so the click lands on real drawn ink outside the stored box.
- **Click border at 1x.** Run `await page.mouse.click(ink.x, ink.y)` and capture a cropped screenshot to `.e2e/results/verify/<run>/border-1x.png`. Selection handles appear around the Element.
- **Confirm selection via nudge.** Run `await page.keyboard.press('Shift+ArrowRight')` and wait for the save to finish. Read `$RUN_DIR/borders.esbozo` from disk: the clicked Element's `x` increased by `10`, and no other Element moved.
- **Click border at high zoom.** Reload `SERVE_URL`, move the pointer to the border edge, send four `await page.mouse.wheel(0, -400)` calls, find the outermost drawn ink again, click it, and capture `.e2e/results/verify/<run>/border-4x.png`. Selection handles appear and `Shift+ArrowRight` shifts `x` by `10` in the saved file.
- **Confirm bare-paper miss.** Click bare paper at least 40px clear of the drawn ink and press `Shift+ArrowRight`. No selection handles appear and the saved file on disk stays unchanged.
- **Regression check.** Run `npx e2e run tests/editor-select.e2e.ts --grep 'drawn border'`. Both 1x and zoomed-in border tests pass.

## Gotchas

- Clicking the Element's stored box edge misses the bug on commit `d2d280c` because roughness draws ink outside the stored box. Aim at the outermost dark pixel of the rendered stroke, not the nominal `x` coordinate.
- Older commits such as `d2d280c` predate the `.esbozo` extension and `/api/health`. Use a `.json` Scene filename (such as `borders.json`) when reproducing regressions against older commits.
- When piping a probe via stdin, resolve `tests/pixels.ts` with `pathToFileURL(resolve('tests/pixels.ts')).href` because stdin probes run from `$TMPDIR/esbozo-probe-*`.
- When comparing an older commit's build with `pnpm probe --folder <other-dist>` or `node <other>/dist/cli.js serve`, start a separate `$RUN_DIR` per build so a nudge from one run does not shift coordinates for the next.
- Pressing `Shift+ArrowRight` saves asynchronously. Wait for the `PUT /api/scenes/<name>` response (or a brief settle) before reading the file from disk.
