// Package esbozo holds what the `ez` binary carries: the core bundle that runs
// in goja, the Kalam it measures and draws with, what measuring Kalam once in
// the build wrote down, and resvg's WebAssembly build that draws the PNG.
//
// All of it is built, not checked in, so a bare `go install` is not supported:
// `pnpm build` writes the bundle, the metrics and resvg's module, and the font is
// in `fonts/`.
package esbozo

import _ "embed"

// CoreBundle is the Scene, Layout and Renderer as one script with no Node API.
//
//go:embed dist/core.js
var CoreBundle []byte

// Kalam is the font `ez` falls back to when no stylesheet or `--font` names one;
// the core measures with these very bytes, handed over as `bundledFont`.
//
//go:embed fonts/Kalam-Regular.ttf
var Kalam []byte

// FontMetrics is what `opentype.js` makes of Kalam, written by the build and
// answered to the core as `bundledFontMetrics`. A Layout only ever asks the
// parse for advance widths, and building every glyph object costs ~91 ms of
// each cold start; the build writes `null` here when it could not prove the
// table, and then the core parses.
//
//go:embed dist/font-metrics.json
var FontMetrics []byte

// ResvgModule is resvg's WebAssembly build, the very bytes `@resvg/resvg-wasm`
// runs in Node: `internal/resvg` runs them in wazero, so the PNG `ez png` writes
// comes from the rasteriser the CLI draws it with.
//
//go:embed dist/resvg.wasm
var ResvgModule []byte
