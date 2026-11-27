package core

import (
	"fmt"
	"os"
	"path/filepath"
	"testing"

	"esbozo"
)

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

func TestRenderMatchesRuntimeFontParse(t *testing.T) {
	table := string(esbozo.FontMetrics)
	if table == "" || table == "null" {
		t.Fatalf("the build wrote no measurement table, so this compares a parse with itself")
	}

	parsedFont := copyOfBundledFont(t)
	source := []byte(advanceScene)

	measured, err := Render(source, RenderOptions{})
	if err != nil {
		t.Fatalf("render: %v", err)
	}
	parsed, err := Render(source, RenderOptions{FontPath: parsedFont})
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

// opentype.js ignores trailing bytes past the last sfnt table, so appending a
// byte forces a runtime parse without changing the font.
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
