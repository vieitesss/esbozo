# esbozo verification map

This directory is the maintained source for verifying user-facing behavior in esbozo. Read this index before driving the editor or CLI, then follow the matching feature file.

## Baseline preconditions

- Run `pnpm build` in the target checkout before launching `pnpm probe` or `ez serve`.
- Create a disposable folder with the `esbozo-` prefix (`mktemp -d "${TMPDIR:-/tmp}/esbozo-verify-XXXXXX"`) for any real-folder `ez serve` run.
- Start `node dist/cli.js serve "$RUN_DIR" --port 0` and export the slashless loopback origin (`http://127.0.0.1:<port>`) from its startup line.
- Run the Doctor check (`GET /api/health` and `GET /api/scenes`, or `GET /api/scenes` alone on older commits without `/api/health`) and require the expected build commit and disposable folder name.
- Never drive an `ez serve` instance started by another run or worktree.

## Driving conventions

- Start every recipe from a fresh build and a clean disposable folder unless its preconditions say otherwise.
- Prefer ARIA roles, accessible names, and keyboard shortcuts over CSS selectors or DOM reads.
- Wait two animation frames after pointer or keyboard input before reading pixels or taking a screenshot.
- Drive real browser input through `tests/cdp.ts` or `await cdp()` for IME composition and CPU throttling.
- Save all proof artifacts under `.e2e/results/verify/<run>/`. Never remove proof artifacts during cleanup.

## Proof and skip reporting

- Capture both the action and the resulting state, not only the final screen.
- Visual proof includes a 1x screenshot and a cropped 800% zoom screenshot (four `page.mouse.wheel(0, -400)` calls) of the touched area.
- Persistence proof reads the saved `.esbozo` or `.json` file from `$RUN_DIR` and checks `node dist/cli.js check <file>` exits `0`.
- Record the feature ID, entry point, and commit hash with every artifact.
- Report any unreachable path with the attempted command and unmet precondition. Do not mark a skipped entry point as verified through another path.

## Feature entry contract

Each feature file starts with an H1 title and one paragraph describing the user-visible behavior. It then uses four H2 sections in this order:

1. `Sub-features` lists short IDs with one line per behavior.
2. `How to get to it (user POV)` lists every user entry point.
3. `Driving it with pnpm probe` starts with `Preconditions:` and pairs each user action with an exact command and observable result.
4. `Gotchas` lists traps that can waste or invalidate a run.

Keep implementation details out of the map. Name only user paths, stable handles, required state, commands, and observable proof.

## Features

- [Select by border](./select-by-border.md) covers clicking drawn Element borders at 1x and 800% zoom, plus bare-paper misses.
- [Draw an arrow](./draw-arrow.md) covers tool rail and shortcut drawing, Snap attachment, and arrow tip alignment at 800% zoom.
- [Edit a Label](./edit-label.md) covers box and arrow Label editing, arrow Label clearance with no background, and real IME input.
- [Export](./export.md) covers light and dark PNG export from the command palette, SVG save output, and CLI parity (`ez png`, `ez render`).
