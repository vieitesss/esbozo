# Edit a Label

Editing a Label lets a user double-click a box or arrow shaft (or press `Enter` on a single selected Element) to type or change its Label in place, including with a real IME, while keeping arrow Labels readable without an opaque background box.

## Sub-features

- `label-box` edits a rectangle, ellipse, or diamond Label via double-click or `Enter` and grows the Element downward when wrapped lines need room.
- `label-arrow` edits an arrow's Label on the shaft, keeps it clear of the shaft and head, and draws no background behind the words.
- `label-ime` handles real browser IME preedit and commit without duplicating or dropping characters.

## How to get to it (user POV)

- Double-click an Element (box body or arrow shaft), or select one Element and press `Enter`.
- Type words into the in-place `Label` textbox (or compose with an OS input method).
- Press `Escape` or click bare paper to finish editing.

## Driving it with pnpm probe

Preconditions:

- `pnpm build` succeeded.
- `$RUN_DIR` holds `labels.esbozo` with a rectangle and an arrow clear of the rail and status line:

```sh
cat >"$RUN_DIR/labels.esbozo" <<'EOF'
{
  "version": 1,
  "title": "Labels",
  "defaults": { "roughness": 1 },
  "elements": [
    { "id": "box", "type": "rectangle", "x": 40, "y": 40, "width": 120, "height": 80 },
    { "id": "link", "type": "arrow", "points": [{ "x": 180, "y": 80 }, { "x": 360, "y": 80 }] }
  ]
}
EOF
```

- `ez serve "$RUN_DIR" --port 0` is running with a slashless `SERVE_URL` and Doctor passed.

- **Edit a box Label.** Double-click `box`, locate `page.getByRole('textbox', { name: 'Label' })`, type `Orders`, and press `Escape`. The saved `$RUN_DIR/labels.esbozo` records `"label": "Orders"` on `box` and `dist/ez check "$RUN_DIR/labels.esbozo"` exits `0`.
- **Edit an arrow Label.** Double-click the midpoint of `link`'s shaft, type `sends` into the `Label` textbox, and press `Escape`. The saved `$RUN_DIR/labels.esbozo` records `"label": "sends"` without changing the arrow's `points`.
- **Inspect arrow Label ink at 1x and 800% zoom.** Capture `.e2e/results/verify/<run>/label-1x.png`. Zoom in on the arrow Label with four `page.mouse.wheel(0, -400)` calls (800% zoom) and capture a cropped `.e2e/results/verify/<run>/label-800pct.png`. The words clear the shaft and arrowhead, and the canvas or Grid behind the words shows no opaque background rectangle.
- **Drive real IME composition.** Reopen the `Label` textbox, open `const session = await cdp()`, send `await session.send('Input.imeSetComposition', { text: '日本語', selectionStart: 3, selectionEnd: 3 })`, confirm the preedit appears without premature commit, then send `await session.send('Input.insertText', { text: '日本語' })` and press `Escape`. The saved Scene holds `"日本語"` once, not twice.
- **Regression check.** Run `npx e2e run tests/labels-edit.e2e.ts` and `npx e2e run tests/labels-ime.e2e.ts`. Both pass.

## Gotchas

- Free-standing Text Elements open a textbox named `Text`, whereas Element Labels open a textbox named `Label`. Use the exact accessible name.
- Synthetic `compositionstart` and `compositionend` events do not match Chromium's real IME state. Always use `cdp()` in a probe or `tests/cdp.ts` (`imeCompose`, `imeCommit`) in e2e tests.
- Caret blink makes pixel assertions flaky unless reduced motion is enabled (`stillCaret()` in `tests/cdp.ts` or `page.emulateMedia({ reducedMotion: 'reduce' })` in a probe).
