package core

import (
	"fmt"
	"os"
	"path/filepath"
	"testing"

	"esbozo"
)

// A Scene whose words hold the two ligatures Kalam carries, centred text and a
// label narrow enough to wrap: the numbers `src/layout.ts` gets from the font
// decide where a centred line starts and where a wrapped one breaks, so an
// advance the table got wrong changes the SVG.
const advanceScene = `{
  "version": 1,
  "title": "Advances",
  "defaults": { "roughness": 0 },
  "elements": [
    { "id": "a", "type": "text", "x": 400, "y": 60, "content": "figure, flow, office, fi fl ffi", "fontSize": "M", "textAlign": "center" },
    { "id": "b", "type": "text", "x": 400, "y": 120, "content": "afflict — fluff, final — fifty", "fontSize": "XL", "textAlign": "right" },
    { "id": "c", "type": "rectangle", "x": 40, "y": 220, "width": 90, "height": 140, "label": "a final flourish" },
    { "id": "d", "type": "line", "points": [{ "x": 200, "y": 380 }, { "x": 240, "y": 380 }], "label": "fifty offices, fluffed" }
  ]
}`

// The bundled font measured at build time and the same font parsed at run time
// must draw the same Scene.
//
// `scripts/build-core.mjs` writes the table `ez` measures with, and the core
// measures from it only for the bundled font's bytes. A font path naming a copy
// with one byte appended is that same font — the parser ignores what follows its
// last table, so every number stays — and the bytes are not the bundled ones, so
// the core parses instead. That copy is what makes this a comparison rather than
// a tautology, and the Scene is the one the table's numbers move.
//
// The test also says which of the two happened: a table the build refused is
// `null`, and then both sides parse and this proves nothing, so a build that
// stopped writing measurements fails here rather than passing quietly.
func TestRenderMatchesRuntimeFontParse(t *testing.T) {
	table := string(esbozo.FontMetrics)
	if table == "" || table == "null" {
		t.Fatalf("the build wrote no measurement table, so this compares a parse with itself")
	}

	parsedFont := copyOfBundledFont(t)
	source := []byte(advanceScene)

	measured, err := Run(Render, source, Options{})
	if err != nil {
		t.Fatalf("render: %v", err)
	}
	parsed, err := Run(Render, source, Options{FontPath: parsedFont})
	if err != nil {
		t.Fatalf("render --font: %v", err)
	}
	if !measured.OK || measured.SVG == "" {
		t.Fatalf("render drew nothing: exit %d, %v", measured.ExitCode, measured.Problems)
	}
	if measured.SVG != parsed.SVG {
		t.Fatalf("SVG differs: %s", whereFirst(measured.SVG, parsed.SVG))
	}
}

// copyOfBundledFont writes the bundled font with one byte appended, which the
// parser reads as the same font and the core does not recognise as the one its
// table was taken from.
func copyOfBundledFont(t *testing.T) string {
	t.Helper()
	bytes, err := os.ReadFile(filepath.Join("..", "..", "fonts", "Kalam-Regular.ttf"))
	if err != nil {
		t.Fatalf("the bundled font is gone: %v", err)
	}
	path := filepath.Join(t.TempDir(), "Kalam-Regular.ttf")
	if err := os.WriteFile(path, append(bytes, 0), 0o644); err != nil {
		t.Fatal(err)
	}
	return path
}

// whereFirst says where two SVGs part company, which is the one thing a failing
// byte comparison cannot say for itself.
func whereFirst(one, other string) string {
	for at := 0; at < len(one) && at < len(other); at++ {
		if one[at] != other[at] {
			return fmt.Sprintf(
				"at byte %d: %q, parsed %q",
				at, one[at:min(len(one), at+40)], other[at:min(len(other), at+40)],
			)
		}
	}
	return fmt.Sprintf("the shorter one ends first: %d bytes measured, %d parsed", len(one), len(other))
}
