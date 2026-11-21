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
- **Seam 1 — `ez` CLI (`test/*.test.ts`):** run real `ez` commands on sample Scenes in temporary folders under `node:test`; cover `Scene`, `Renderer`, and `Layout` through this seam unless a case cannot be reached from the CLI.
- **Seam 2 — Editor in a real browser (`tests/*.e2e.ts`):** drive the built editor with pointer, role, and keyboard input and assert on the saved Scene, rendered pixels, or `vision: 'only'` visual checks; see `tests/README.md` for scripts, files, and the model-free vs. agent split.

## Invariants and boundaries

- **Single owner:** schema choices and ranges, canonical geometry, font loading, save target (`{ folder, name }`), and filename rules each have one owner; import it rather than duplicating or shadowing it.
- **One canonical rendered geometry:** paint, bounds, Snap resolution, hit-testing, drag projection, and caret placement all consume `Renderer`'s canonical geometry (including glyph overhang and drawn strokes) — never raw Elements or Editor-side approximations.
- **Fail loudly:** return `null` only for expected absence (such as HTTP 404); surface malformed input, invalid Snaps, and I/O errors directly rather than falling back silently.
- **One red adversarial test per contract:** prove each contract or regression test goes **red** when the guarded behaviour is removed (using contrasting backgrounds/ink, visible UI states, and fixture-derived expectations rather than self-referential helpers), probing mutated Scenes, overlapping or zero-size geometry, XML control characters, 404 assets, concurrent paired writes, encoded dot segments, and cross-origin writes.

## Async & gesture lifecycle

- **Generation-bound async:** `src/editor/connection.ts` binds Scene GETs and save status to `#token` and font loads to `#fontRequest` (so font changes and Scene switches do not drop each other), and `src/editor/clipboard.ts` binds clipboard calls to `host.token()`, dropping stale completions. Save PUTs serialise on `#saveQueue` to the `SaveTarget` captured when queued and still finish there while stale status and `403` answers are dropped; a `403` on the active target makes the editor read-only.
- **Clean teardown:** on a Scene switch, disconnect, or write-access loss, `src/editor/editor.ts` (`#forget`, `#endEdits`) discards any open Text or Label session, disarms the tool to Select, and cancels the active gesture (Scene-editing gestures on read-only) before the next paint. On window `blur`, `visibilitychange`, or `pointercancel`, `src/editor/gestures.ts` (`release`, `cancel`) cancels only the active gesture and pointer capture; input `blur` in `src/editor/text-session.ts` commits an open Text or Label session and discards it only when detached.
