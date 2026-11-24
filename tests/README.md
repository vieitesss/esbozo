# Browser tests

Three scripts, each running a real page in Chromium through
e2e: most start the built editor, and `svg.e2e.ts` serves the SVG `ez render`
wrote instead. Build first (`pnpm build`), or use the scripts, which build.

`editor-*.e2e.ts` serves the page statically and stubs the File System Access
API, one file per area of the editor it drives — opens, files, select, bends,
move, pan-zoom, page, style, status, arrange, palette, clipboard, export — so an
inner loop re-runs the area it iterates on, with what those files share in
`editor-shared.ts`;
`labels-*.e2e.ts` places, draws, drags, selects and edits Labels and Texts in
place on the same page, one file per thing a person sees — edit, draw, caret,
ime, view, select, drag — so an inner loop re-runs the area it iterates on,
with what those files share in `labels-shared.ts`; `serve.e2e.ts` runs `ez
serve` on a real temporary folder, so it saves and
reads real files;
`embed.e2e.ts` loads `ez bundle`'s output in a page that holds only
the element and its attributes, beside a stub of the same save API;
`svg.e2e.ts` opens the SVG `ez render` wrote as a page of its own, with no
stylesheet anywhere, then as an `<img>` on a page that declares no theme
either, and then inlined in a host page that declares its own theme. Every
`*.e2e.ts` file must appear in exactly one of the scripts below: `check-rules`
holds the list, so a new file cannot sit unrun.

| Script | Files | Model calls |
| --- | --- | --- |
| `pnpm e2e` | `editor-*.e2e.ts`, `drawing.e2e.ts`, `labels-*.e2e.ts`, `snap.e2e.ts`, `serve.e2e.ts`, `embed.e2e.ts`, `cdp.e2e.ts`, `svg.e2e.ts` | none |
| `pnpm e2e:agent` | `visual.e2e.ts` | one per `agent.assert` / `agent.waitFor`, every run |
| `pnpm e2e:shots` | `screenshots.e2e.ts` | none; skipped unless `ESBOZO_SHOTS` names a folder |

For fast inner-loop runs without creating scratch files or running an entire suite, filter to one test with `npx e2e run tests/<file>.e2e.ts:<line>`, `--grep <pattern>`, or `--last-failed` (after `pnpm build`).

When a failure shows only in CI and not here, run the same file on the Linux
that CI runs it on: `pnpm e2e:linux [e2e args]`. It builds `docker/e2e.Dockerfile` once
(Ubuntu 26.04, the release CI's `ubuntu-latest` runs, with the Node
`.node-version` pins and the pnpm `package.json` pins, and Chromium with its
system libraries), then reuses that image while every file it
is built from holds still. The worktree is copied into the container at run time
without the host's `node_modules`, so a source change costs no rebuild, and the
arguments are `e2e run`'s own — `pnpm e2e:linux tests/cdp.e2e.ts:42`,
`pnpm e2e:linux --grep '<title>'` — with none it runs what `pnpm e2e` runs.
Docker has to be running, and it has to see the worktree: the run checks the
mount in a container of its own first, and a Docker VM that does not share that
folder — on macOS, one under `/tmp` unless Docker Desktop was told to share it —
stops it at once with the host path, the likely cause and the fix, instead of a
copy of nothing. `ESBOZO_*` and `OPENCODE_API_KEY` cross into the
container and nothing else, the container is removed however the run ends, and
the run exits with the suite's own code, so a failure is still a red shell. This
is the loop for a `Meta+`-vs-`Ctrl+` or middle-click failure that only the Linux
Chromium shows: it is the same suite, not a second one.

For one look at the live editor with no e2e file at all, write a probe whose default export takes `{ page, url, cdp }` and run `pnpm probe <probe.mjs>`: it serves the built editor on an ephemeral port, opens Chromium, prints what the probe returned as JSON, and closes both however the probe ends. It does not build, so `pnpm build` first.

For a quick Node-only probe against `src/` modules (`parseScene`, `drawnGeometry`, `snapTarget`, `Rail`, `Hand`, `Exits`, etc.) without launching Chromium or bundling by hand, run `pnpm probe:node [probe.mjs]` (or pipe source on stdin): it calls the default export with `loadProjectModules()`, prints any non-`undefined` return value as JSON, and cleans up its temporary folders on exit.

`pnpm test` and the four `e2e` scripts run through `scripts/fresh-tmp.mjs`, which hands the run a fresh `TMPDIR` and fails it when an `esbozo*` folder is still in there at the end: a test that stops removing its folder is a red run, not a folder a person finds weeks later. A bare `npx e2e run` skips that guard, which is the point of the fast inner loops above and the cost of them.

The four `e2e` scripts also run one at a time per machine, through `scripts/queue.mjs`: a full run already uses every core, and four started at once from four worktrees all timed out. A second run prints whose run it waits on and starts when that one ends. To prove a change, run the e2e files it touches; the full suite is CI's.

## Shared helpers: `tests/helpers.ts`

Open the editor, pick stubbed folders, and create a new Scene:
`Ui`, `Folders`, `openEditor`, `openNewScene`, `browseFolder`.

Hold, release, or refuse stubbed disk and clipboard writes, and hold a
clipboard read: `holdWrites`, `releaseWrite`, `refuseWrite`, `allowWrites`,
`holdClipboardWrites`, `releaseClipboardWrite`, `holdClipboardReads`,
`releaseClipboardRead`, `refuseClipboardRead`.

Read the stubbed folder files and the parsed saved Scene:
`savedFiles`, `savedScene`, `SavedScene`.

Map Scene coordinates to page points, drive pointer clicks and drags, and wait for the next painted frame:
`Point`, `View`, `at`, `drag`, `clickScene`, `doubleClickScene`, `dragBy`, `settle`.

Compare editor output against the CLI, run printed fallback commands, and read downloaded PNGs:
`cliRender`, `cliCheck`, `cliCheckBytes`, `expectSvgMatchesCli`, `cliPng`, `runAsWritten`, `Downloaded`, `exported`.

Gate and aggregate opt-in wall-clock timing checks:
`TIMING`, `median`.

Load core Scene fixtures and their fitted views for general, empty, poster, and invalid Scenes:
`SCENE`, `VIEW`, `MIXED_SCENE`, `MIXED`, `EMPTY`, `POSTER_SCENE`, `POSTER`, `BROKEN_SCENE`.

Load Label and Text fixtures and their fitted views for editing, placement, crossing shafts, and overflow:
`WORDS_SCENE`, `WORDS`, `BLANK_SCENE`, `ROOM_SCENE`, `ROOM`, `SPACED_SCENE`, `BESIDE_SCENE`, `BESIDE`, `LABELLED_SCENE`, `LABELLED`, `UNPLACED_SCENE`, `UNPLACED`, `FOLLOW_SCENE`, `FOLLOW`, `OVERLAP_SCENE`, `OVERLAP`, `HEAD_OVER_SCENE`, `HEAD_OVER`, `CHORD_SCENE`, `CHORD`, `TILTED_SCENE`, `TILTED`, `POINT_SCENE`, `POINT`, `CROSSED_SCENE`, `CROSSED`, `OVERFLOW_SCENE`, `OVERFLOW`.

Load Snap and routing fixtures and their fitted views for attached arrows and line crossings:
`SNAPPED_SCENE`, `SNAPPED`, `HYPHEN_SCENE`, `SNAP_SCENE`, `SNAP`, `CROSSING_SCENE`, `CROSSING`.

Load Arrange and Spread fixtures and their fitted views for alignment, layer order, and distribution:
`PINNED_SCENE`, `PINNED`, `UNEVEN_SCENE`, `UNEVEN`, `LACED_SCENE`, `LACED`, `THREE_SCENE`, `THREE`, `SPREAD_SCENE`, `SPREAD`, `ARRANGE_SCENE`, `ARRANGE`, `TETHER_SCENE`, `TETHER`.

Load docked Style menu clearance fixtures and their fitted views at standard and narrow viewports:
`EDGE_SCENE`, `EDGE`, `EDGE_1366`, `PRESS_SCENE`, `PRESS`, `WIDE_SCENE`, `WIDE_1366`, `LONG_SCENE`, `LONG_1366`, `SHIFTED_SCENE`, `SHIFTED`, `SHAFT_SCENE`, `SHAFT`.

Load large-page and dense-word fixtures for PNG and CLI export limits:
`TEXT_SCENE`, `BIG_SCENE`, `XL_WORDS_SCENE`, `WIDE_WALL_SCENE`.

Other shared test modules hold the rest: `tests/pixels.ts` decodes screenshots and measures pixel ink, `tests/cdp.ts` sends real browser IME and CPU-throttling commands, `tests/labels-shared.ts` holds serialized Scenes and ink thresholds for the Label suites, and `tests/editor-shared.ts` holds serialized Scenes, paper regions, and Style menu or command-palette controls for the editor suites.

## Real browser input: `tests/cdp.ts`

e2e's `browser` fixture drives the page through roles, pointer and keys, and
hands out no CDP session. Some contracts need one anyway: an input method's
preedit (`Input.imeSetComposition`, `Input.insertText`) and a slow CPU
(`Emulation.setCPUThrottlingRate`) cannot be faked by dispatching events from a
test, which is how an IME bug once passed a suite that drove the editor with
synthetic `compositionstart`/`compositionend` events.

`tests/cdp.ts` reaches the page through `surfaceOf(engine)`: `e2e.config.ts`
keeps its `web()` handle there, and e2e loads the config in each worker process,
so a test reads back the live page of the run it is in. It exports
`imeCompose(text)`, `imeCommit()`, `throttleCpu(rate)`, `stillCaret()`, and
`livePage()` for a test's own page setup. `imeCommit()` confirms a preedit that
is still open, and refuses one the browser already ended (a blur ends a
composition) rather than typing the words a second time. `stillCaret()` asks for
`prefers-reduced-motion: reduce`, which the page answers with a caret that does
not blink: a screenshot of a flickering caret catches it in either half, and a
pixel test cannot say where it is. `cdp.e2e.ts` is the proof, on a plain
`<textarea>` and not the editor: the preedit is the field's value while the
composition is open, the commit and the click-away each end it, and 4×
throttling measurably slows the page. `labels-ime.e2e.ts` then drives the editor's
own field through it, so an outside press during a real composition and the
candidate a person picks are tested against Chromium's composition, not a
sequence of events a test dispatched. Driving the page out of band is the
harness's documented escape hatch; reach for it for input no event can fake, not
to shortcut a role click.

### Timing assertions are opt-in

`cdp.e2e.ts` sends the CPU-throttle command and puts the CPU back on every run,
and checks that the page still answers. That 4× is *measurably* slower is proved
only with `ESBOZO_TIMING=1` set:

```sh
ESBOZO_TIMING=1 npx e2e run tests/cdp.e2e.ts
```

A wall-clock sample is not the page's alone: one scheduler stall on a shared
runner can move it as much as the emulated CPU does, and a budget assertion that
fails on a quiet laptop's neighbours is a flake, not a finding. The opted-in
check takes five unthrottled and five throttled spins, interleaved, and compares
their medians, so one stall cannot decide it.

`editor-select.e2e.ts` measures the page's other wall clock the same way: both
presses answer from the boxes the frame painted, and they differ in how many
Elements they pass — one asks a single box, the other walks past every Element
of a dense Scene first. The two are interleaved, five each, and compared by
medians.

```sh
ESBOZO_TIMING=1 npx e2e run tests/editor-select.e2e.ts --grep 'reads the ink'
```

## Why the agent suite is separate

e2e's model steps are judgements of the live screen, so `agent.assert` and
`agent.waitFor` call the model on every run. `pnpm e2e` is therefore model-free
and needs no key, and `pnpm e2e:agent` needs `OPENCODE_API_KEY` (or a `.env` at
the project root) and costs a call per judgement.

Drive the page the way a person does: role clicks and keys, as the theme switch
and the tool rail already are. `agent` is then only asked to judge (`assert`,
`waitFor`), never to act, so nothing is recorded and `.e2e/cache/` stays unused
and ignored.
