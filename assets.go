// Package esbozo holds what the `ez` binary carries: the core bundle that runs
// in goja, the Kalam it measures and draws with, what measuring Kalam once in
// the build wrote down, resvg's WebAssembly build that draws the PNG, the
// embeddable editor module `ez bundle` writes, the served page and the files
// beside it, the agent skill it prints and installs, the install script
// `ez update` re-runs, and the stamps it answers `--version` and `ez serve`
// with.
//
// All but the skill and the install script is built, not checked in, so a bare
// `go install` is not supported: `pnpm build` writes the bundles, the metrics,
// resvg's module and the stamp, and the font is in `fonts/`; the skill in
// `skills/` and the script in `scripts/` are checked in.
package esbozo

import (
	"embed"
	"strings"
)

// CoreBundle is the Scene, Layout and Renderer as one script with no Node API.
//
//go:embed dist/core.js
var CoreBundle []byte

// Kalam is the font `ez` falls back to when no stylesheet or `--font` names one;
// the core measures with these very bytes, handed over as `bundledFont`. It is
// also what `ez serve` answers `/fonts/Kalam-Regular.ttf` with, so the binary
// carries the font once.
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

// ResvgModule is resvg's WebAssembly build — the bytes `@resvg/resvg-wasm` runs
// in Node — which `internal/resvg` runs in wazero.
//
//go:embed dist/resvg.wasm
var ResvgModule []byte

// EmbedBundle is the editor as one ES module — the `<esbozo-editor>` element and
// the stylesheet it carries — which `ez bundle` writes beside the page that
// loads it, so the page needs no second request.
//
//go:embed dist/embed.js
var EmbedBundle []byte

// Skill is the agent skill `ez skill` prints and `ez skill install` copies, so the
// skill always matches the binary that is running.
//
//go:embed skills/esbozo/SKILL.md
var Skill []byte

// InstallScript is `scripts/install.sh` — the script `ez update` re-runs with the
// flags it was given and `--dir` set to the folder the binary runs from — so what
// `ez update` installs is what this binary carries, as `Skill` is to
// `ez skill install`.
//
//go:embed scripts/install.sh
var InstallScript []byte

const mainSuffix = "-main+"

//go:embed dist/version
var versionStamp string

// PageFiles is the served page and the bytes `ez serve` sends for it: the page
// itself, its stylesheet, its script, Kalam's licence, and the variants the build
// compresses each text file into. The list is `PAGE_ASSETS` in
// `src/page-assets.ts` read from this side, so a build that wrote no variant
// fails here instead of sending the page uncompressed. Kalam itself is not here:
// `serve` sends `esbozo.Kalam`, the copy the core measures with, above.
//
//go:embed dist/editor.html dist/editor.html.br dist/editor.html.gz dist/editor.css dist/editor.css.br dist/editor.css.gz dist/editor.js dist/editor.js.br dist/editor.js.gz dist/fonts/OFL.txt dist/fonts/OFL.txt.br dist/fonts/OFL.txt.gz
var PageFiles embed.FS

//go:embed dist/build-id
var buildID string

// Build is buildID, with the newline the build wrote gone.
var Build = strings.TrimSpace(buildID)

//go:embed dist/built-at
var builtAt string

// BuiltAt is builtAt, with the newline the build wrote gone; it is empty for a
// build that wrote no time, and `ez serve` then names the build alone.
var BuiltAt = strings.TrimSpace(builtAt)

// Stamp is what `ez --version` prints, with the newline the build wrote gone.
var Stamp = strings.TrimSpace(versionStamp)

// Version is the version a Release is — Stamp without the Main suffix, which is
// there for every other build; `ez bundle` names its file after this.
var Version, _, _ = strings.Cut(Stamp, mainSuffix)
