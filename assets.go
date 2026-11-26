// Package esbozo holds what the `ez` binary carries: the core bundle that runs
// in goja, the Kalam it measures and draws with, and what measuring Kalam once
// in the build wrote down.
//
// All of it is built, not checked in: `node scripts/build-core.mjs` writes
// `dist/core.js` and `dist/font-metrics.json`, and the font is in `fonts/`. A
// bare `go install` is therefore not supported; `pnpm build` runs both halves,
// the TypeScript one and this one.
package esbozo

import _ "embed"

// CoreBundle is the Scene, Layout and Renderer as one script with no Node API.
//
//go:embed dist/core.js
var CoreBundle []byte

// Kalam is the font `ez` falls back to when no stylesheet or `--font` names one.
// The core bundle measures with these very bytes, handed over as `bundledFont`
// rather than bundled again.
//
//go:embed fonts/Kalam-Regular.ttf
var Kalam []byte

// FontMetrics is what `opentype.js` makes of Kalam, taken by
// `node scripts/build-core.mjs` and answered to the core as
// `bundledFontMetrics`.
//
// A Layout only ever asks the parse for advance widths, and building 1027 glyph
// objects to answer it costs ~91 ms of every cold start; the build pays it once,
// and writes `null` here when it could not prove the table it took, so the core
// falls back to parsing.
//
//go:embed dist/font-metrics.json
var FontMetrics []byte
