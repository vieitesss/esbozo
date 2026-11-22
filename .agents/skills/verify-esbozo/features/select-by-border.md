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
- `$RUN_DIR` holds `borders.json` with all three unfilled Elements at `roughness: 1`.
- `ez serve "$RUN_DIR" --port 0` is running with a slashless `SERVE_URL` and Doctor passed.

### Complete runnable journey (issue #27)

Run this sequence from the repository root with no extra files:

```sh
pnpm build
RUN_DIR="$(mktemp -d "${TMPDIR:-/tmp}/esbozo-verify-XXXXXX")"
cat >"$RUN_DIR/borders.json" <<'EOF'
{
  "version": 1,
  "title": "Borders",
  "defaults": { "roughness": 1 },
  "elements": [
    { "id": "rect", "type": "rectangle", "x": 40, "y": 40, "width": 120, "height": 80 },
    { "id": "oval", "type": "ellipse", "x": 220, "y": 40, "width": 140, "height": 110 },
    { "id": "dia", "type": "diamond", "x": 420, "y": 40, "width": 160, "height": 120 }
  ]
}
EOF

node dist/cli.js serve "$RUN_DIR" --port 0 >"$RUN_DIR/serve.log" 2>&1 &
SERVE_PID=$!
while ! grep -q 'http://127\.0\.0\.1:' "$RUN_DIR/serve.log"; do sleep 0.1; done
export SERVE_URL="$(sed -n 's|.*\(http://127\.0\.0\.1:[0-9]*\).*|\1|p' "$RUN_DIR/serve.log" | head -n 1)"
export RUN_DIR

# Doctor check (falls back to /api/scenes on older commits where /api/health returns 404)
curl -fsS "${SERVE_URL}/api/health" || echo "no /api/health on this build"
curl -fsS "${SERVE_URL}/api/scenes"

# Drive the border click from rendered pixels and return { edgeX, inkX, rectX, selected }
pnpm probe <<'EOF'
import { mkdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const { decodePng } = await import(pathToFileURL(resolve('tests/pixels.ts')).href);

export default async function ({ page }) {
  const loaded = page.waitForResponse(
    (res) => res.url().endsWith('/api/scenes/borders.json') && res.ok(),
  );
  await page.goto(process.env.SERVE_URL, { waitUntil: 'load' });
  await loaded;
  await page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  );

  // Fitted 1:1 view of Borders in 1280x800: panX=330, panY=300, rect left edge is (370, 380).
  const edge = { x: 370, y: 380 };
  const image = decodePng(await page.screenshot());
  const scale = image.width / (await page.evaluate(() => window.innerWidth));
  const row = Math.round(edge.y * scale);
  const startX = Math.max(0, Math.round((edge.x - 15) * scale));
  const endX = Math.min(image.width, Math.round(edge.x * scale));

  let inkX = null;
  for (let x = startX; x < endX; x += 1) {
    const at = (row * image.width + x) * image.channels;
    const red = image.data[at] ?? 255;
    const green = image.data[at + 1] ?? red;
    const blue = image.data[at + 2] ?? red;
    const luminance = (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255;
    if (luminance < 0.6) {
      inkX = x / scale + 0.5;
      break;
    }
  }
  if (inkX === null) {
    throw new Error(`no border ink found left of (${edge.x}, ${edge.y})`);
  }

  await page.mouse.click(inkX, edge.y);
  await page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  );

  const outDir = resolve('.e2e/results/verify/issue-27');
  await mkdir(outDir, { recursive: true });
  await page.screenshot({
    path: join(outDir, 'border-1x.png'),
    clip: { x: 320, y: 310, width: 240, height: 150 },
  });

  const saved = page.waitForResponse(
    (res) => res.request().method() === 'PUT' && res.url().endsWith('/api/scenes/borders.json'),
  );
  await page.keyboard.press('Shift+ArrowRight');
  await Promise.race([saved, page.waitForTimeout(500)]);

  const after = JSON.parse(await readFile(join(process.env.RUN_DIR, 'borders.json'), 'utf8'));
  const rectX = after.elements.find((element) => element.id === 'rect')?.x;
  return { edgeX: edge.x, inkX, rectX, selected: rectX === 50 };
}
EOF

node dist/cli.js check "$RUN_DIR/borders.json"
kill "$SERVE_PID" && wait "$SERVE_PID" 2>/dev/null || true
rm -rf "$RUN_DIR"
```

On a fixed build, `pnpm probe` prints `selected: true` with `rectX: 50`, `.e2e/results/verify/issue-27/border-1x.png` shows selection handles around `rect`, and `node dist/cli.js check "$RUN_DIR/borders.json"` exits `0`. On commit `d2d280c` before the fix, the same probe prints `selected: false` with `rectX: 40`.

### Additional checks

- **Click border at 800% zoom.** Reload `SERVE_URL`, move the pointer to `(370, 380)`, send four `await page.mouse.wheel(0, -400)` calls (800% zoom), scan up to 60px left of `edge.x` for outermost dark ink, click it, and capture `.e2e/results/verify/<run>/border-800pct.png`. Selection handles appear and `Shift+ArrowRight` shifts `x` by `10` in the saved file.
- **Confirm bare-paper miss.** Click bare paper at least 40px clear of the drawn ink and press `Shift+ArrowRight`. No selection handles appear and the saved file on disk stays unchanged.
- **Regression check.** Run `npx e2e run tests/editor-select.e2e.ts --grep 'drawn border'`. Both 1x and zoomed-in border tests pass.
- **Detached worktree cleanup (when comparing an older commit).** If you created a disposable worktree with `OLD_WT="$TMPDIR/esbozo-verify-27"` and `git worktree add --detach "$OLD_WT" d2d280c`, remove it after killing its `ez serve` PID:

```sh
git worktree remove --force "$OLD_WT"
git worktree list
```

## Gotchas

- Clicking the Element's stored box edge misses the bug on commit `d2d280c` because roughness draws ink outside the stored box. Aim at the outermost dark pixel of the rendered stroke, not the nominal `x` coordinate.
- Older commits such as `d2d280c` predate the `.esbozo` extension and `/api/health`. Use a `.json` Scene filename (such as `borders.json`) when reproducing regressions against older commits.
- When piping a probe via stdin, resolve `tests/pixels.ts` with `pathToFileURL(resolve('tests/pixels.ts')).href` because stdin probes run from `$TMPDIR/esbozo-probe-*`.
- When comparing an older commit's build with `pnpm probe --folder <other-dist>` or `node <other>/dist/cli.js serve`, start a separate `$RUN_DIR` per build so a nudge from one run does not shift coordinates for the next.
- Pressing `Shift+ArrowRight` saves asynchronously. Wait for the `PUT /api/scenes/<name>` response (or a brief settle) before reading the file from disk.
