# Coding Standards

Judgement-call rules for code and tests. Mechanical checks (lint, unused exports, `node:*` imports, glossary-term scanning) are enforced by `pnpm check`.

## Architecture and conventions

- **Four deep modules behind narrow exports:** `Scene` (schema, validation, canonical serialisation), `Renderer` (pure, deterministic Scene-to-SVG), `Layout` (text measurement, Label wrapping, overflow), and `Editor` (custom element over the save API); export only what another module or entry point calls so refactors stay local.
- **Shared Layout and identical SVG output:** the Renderer, the Editor's live overflow outline, and `ez check` all measure through `Layout`, and the browser Editor and `ez render` produce the same SVG bytes so CLI and browser never drift.
- **Small, framework-free footprint:** keep runtime dependencies to `roughjs`, `opentype.js`, and `@resvg/resvg-wasm` (CLI PNG only); every new dependency requires explicit approval.
- **Glossary discipline:** use the terms in `GLOSSARY.md` (`Scene`, `Element`, `Label`, `Text`, `Snap`, `Grid`) across identifiers, UI copy, tests, and docs so one vocabulary spans the codebase.
- **Grid and Snap separation:** Grid is a visual guide only and Elements move freely; Snap applies only to arrow and line ends as a per-end option (attached or free, set in the style menu) with target highlighting and `Alt` to skip Snap for one drag.
- **CSS-variable theming and external editor font:** SVGs take colours and font solely from `--ink`, `--paper`, `--muted`, and `--font-hand`, each with the light theme's value as its own fallback so a saved SVG opened with no stylesheet still draws, and with no scripts or external references; the editor bundle loads its font from the host URL rather than embedding Kalam.
- **Plain-text CLI and local-first server:** `ez` commands print plain text with distinct non-zero exit codes, and `ez serve` binds to `127.0.0.1` by default with no built-in authentication.

## Testing

- **External behaviour only:** assert on written files, exit codes, plain-text messages, saved Scene JSON, rendered pixels, or `vision: 'only'` judgements — never internal state, private helpers, or DOM structure — so behaviour-preserving refactors stay green.
- **CLI seam (`test/*.test.ts`):** run real `ez` commands on sample Scenes in temporary folders under `node:test`; cover `Scene`, `Renderer`, and `Layout` through this seam unless a case cannot be reached from the CLI.
- **Browser seam (`tests/*.e2e.ts`):** drive the built editor in a real browser with pointer, role, and keyboard input and assert on the saved Scene, rendered pixels, or `vision: 'only'` visual checks; see `tests/README.md` for scripts, files, and the model-free vs. agent split.
- **Module seam (`test/*.test.ts`):** reach `Scene`, `Renderer`, `Layout`, or the allow-listed Editor modules (`scripts/check-rules.mjs`) through `test/modules.ts` when a contract cannot be reached from the CLI.
- **Script seam (`test/*.test.ts`):** run a repository script or harness (`scripts/*.mjs`, packaging, or server helpers) against temporary fixtures.
- **Go module seam (`internal/*/*_test.go`):** cover a contract `ez` cannot reach or pin from the CLI — the goja↔JS boundary (the strict JSON reader, lone surrogates, number overflow), wazero cache recovery and fallback, and wasm trap messages — beside the Go package that owns it; anything an `ez` command shows is the CLI seam's (`EZ_BIN=… node --test test/*.test.ts`).

## Invariants and boundaries

- **Single owner:** schema choices and ranges, canonical geometry, font loading, save target (`{ folder, name }`), and filename rules each have one owner; import it rather than duplicating or shadowing it.
- **One canonical rendered geometry:** paint, bounds, Snap resolution, hit-testing, drag projection, and caret placement all consume `Renderer`'s canonical geometry (including glyph overhang and drawn strokes) — never raw Elements or Editor-side approximations.
- **Fail loudly:** return `null` only for expected absence (such as HTTP 404); surface malformed input, invalid Snaps, and I/O errors directly rather than falling back silently.
- **One red adversarial test per contract:** prove each contract or regression test goes **red** when the guarded behaviour is removed (using contrasting backgrounds/ink, visible UI states, and fixture-derived expectations rather than self-referential helpers), probing mutated Scenes, overlapping or zero-size geometry, XML control characters, 404 assets, concurrent paired writes, encoded dot segments, and cross-origin writes.

## Async & gesture lifecycle

- **Generation-bound async:** `src/editor/connection.ts` binds Scene reads (`open`) to `#token` and `#openRequest` (so the latest open wins within a connection) and font loads to `#fontRequest` (so font changes and Scene switches do not drop each other), and `src/editor/clipboard.ts` binds clipboard calls to `host.token()` and `host.target()` — the connection, and the Scene open in it — dropping stale completions. Save writes serialise on `#saveQueue` to the `SaveTarget` captured when queued and still finish there: only the newest write in `#saveQueue` reports `saved` while its target is still active, stale failures and `403` answers for another target are dropped, and a `403` on the active target makes the editor read-only.
- **Clean teardown:** `src/editor/exits.ts` (`Exits`) owns every exit — `forget`, `sceneSwitch`, `disconnect`, `readOnly`, `interrupt` (window `blur` or `visibilitychange`), `focusOut`, `escape`, and `pointerCancel` — and what each held thing (notes, Rail drag, Text or Label session, active gesture, Space pan, picked Bend point, selection, and tool) does on it. On `forget`, `sceneSwitch`, `disconnect`, or `readOnly`, the table discards any open Text or Label session, disarms the tool to Select, and ends the active gesture (`sceneSwitch` and `readOnly` cancel only Scene-editing gestures and selection sweeps, and `escape` finishes a Shaft being placed or cancels those too); on `interrupt` or `pointerCancel`, it ends only the active gesture and pointer capture (plus Space pan and Rail drag on `interrupt`). Input `blur` in `src/editor/text-session.ts` commits an open Text or Label session and discards it only when detached. `tests/editor-interrupts.e2e.ts` holds the browser table of every gesture by every exit; add a row for a new gesture and a column for a new exit.
