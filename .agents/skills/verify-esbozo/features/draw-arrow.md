# Draw an arrow

Drawing an arrow lets a user drag an arrow from the tool rail or keyboard shortcut, optionally Snap either end to an Element so it follows that Element, and see the arrow shaft meet its arrowhead cleanly with no overshoot.

## Sub-features

- `arrow-rail` selects the `Arrow` tool from the rail and draws a two-point arrow.
- `arrow-shortcut` activates the arrow tool by keyboard and returns to Select after one drag.
- `arrow-snap` attaches an arrow end to an Element so moving that Element updates the arrow's saved point.
- `arrow-head-ink` renders the arrow shaft stopping inside the arrowhead with no overshoot past the tip.

## How to get to it (user POV)

- Click the `Arrow` button in the tool rail, or press `a` while focus is outside an editable field.
- Drag on the canvas from start point to end point. Drag onto an Element's border or body to Snap that end (hold `Alt` to disable Snap).
- Zoom in on the arrowhead with the mouse wheel or `Meta+=` to inspect where the shaft meets the head.

## Driving it with pnpm probe

Preconditions:

- `pnpm build` succeeded.
- `$RUN_DIR` holds a Scene with two rectangles clear of the tool rail and status line.
- `ez serve "$RUN_DIR" --port 0` is running and Doctor passed on `SERVE_URL`.

- **Activate Arrow tool.** Navigate to `SERVE_URL` and run `await page.getByRole('button', { name: 'Arrow' }).click()`. The Arrow tool becomes active.
- **Draw a Snapped arrow.** Drag from the right edge of the first rectangle to the left edge of the second rectangle using `page.mouse.move`, `down`, intermediate `move` steps, and `up`. The arrow renders between both rectangles and the tool returns to Select.
- **Verify saved Scene and Snap.** Read the saved Scene file in `$RUN_DIR` and run `node dist/cli.js check "$RUN_DIR/<scene>"`. Exit code is `0` and the new Element has `"type": "arrow"` with two points. Drag the target rectangle 20px right and confirm the arrow's end point follows in the saved file.
- **Inspect tip and head at 1x and high zoom.** Capture a 1x screenshot to `.e2e/results/verify/<run>/arrow-1x.png`. Move the pointer onto the arrowhead, send four `await page.mouse.wheel(0, -400)` calls, wait two animation frames, and capture a tight crop around the head to `.e2e/results/verify/<run>/arrow-head-4x.png`. The shaft meets the arrowhead cleanly with zero ink protruding past the tip.
- **Regression check.** Run `npx e2e run tests/drawing.e2e.ts --grep 'rail draws'` and `npx e2e run tests/snap.e2e.ts`. Both pass.

## Gotchas

- A single-step `mouse.move` jump can skip hover feedback for Snap. Pass `{ steps: 10 }` to `page.mouse.move` during the drag.
- Roughness wobbles the shaft slightly, so always inspect the arrowhead at 4x zoom or higher rather than judging from a 1x full-page shot.
- After drawing one Element, the editor returns to the Select tool automatically. Re-click `Arrow` before drawing a second arrow.
