package resvg

import (
	"bytes"
	"fmt"
	"os"
	"testing"
)

// The options `src/png.ts` hands resvg: the Scene's paper as the background, no
// scaling. Spelled out here so the test goes in through the same door the core
// does, JSON and all.
const optionsJSON = `{"background":"rgb(255,255,248)","fitTo":{"mode":"original"}}`

// TestRasteriseMatchesTheNodeModule: the PNG has to be the module's own bytes.
//
// `testdata/triangle.png` was written by the real `@resvg/resvg-wasm` in Node,
// from `testdata/triangle.svg` and `optionsJSON` — the same module the CLI
// runs. So this compares the Go call sequence against the one the CLI gets for
// free, rather than against a hash this package made itself.
func TestRasteriseMatchesTheNodeModule(t *testing.T) {
	want := triangle(t)

	got, err := Rasterise(triangleSVG(t), optionsJSON)
	if err != nil {
		t.Fatalf("cannot rasterise: %v", err)
	}
	if !bytes.Equal(got, want) {
		t.Fatalf("PNG %d bytes, Node's %d; %s", len(got), len(want), firstDifference(got, want))
	}
}

// TestRasteriseRefusesAndRecovers: the module is started once and reused, so a
// document resvg cannot parse must come back as its own message — and the next
// Scene must still draw. A call sequence that leaves the heap or the shadow
// stack dirty would pass the test above and fail here.
func TestRasteriseRefusesAndRecovers(t *testing.T) {
	want := triangle(t)

	if _, err := Rasterise("this is not a drawing", optionsJSON); err == nil {
		t.Fatal("resvg accepted a document that is not an SVG")
	} else if err.Error() == "" {
		t.Fatal("resvg refused the document without a message")
	}

	got, err := Rasterise(triangleSVG(t), optionsJSON)
	if err != nil {
		t.Fatalf("cannot rasterise after a refusal: %v", err)
	}
	if !bytes.Equal(got, want) {
		t.Fatalf("PNG after a refusal is %d bytes, Node's %d; %s", len(got), len(want), firstDifference(got, want))
	}
}

// triangleSVG is the drawing `testdata/triangle.png` was made from.
func triangleSVG(t *testing.T) string {
	t.Helper()
	svg, err := os.ReadFile("testdata/triangle.svg")
	if err != nil {
		t.Fatal(err)
	}
	return string(svg)
}

// triangle is that drawing as Node's module wrote it.
func triangle(t *testing.T) []byte {
	t.Helper()
	png, err := os.ReadFile("testdata/triangle.png")
	if err != nil {
		t.Fatal(err)
	}
	return png
}

// firstDifference says where two byte strings part company, because a PNG that
// is merely the wrong length is not worth a bisect.
func firstDifference(one, other []byte) string {
	end := min(len(one), len(other))
	for at := range end {
		if one[at] != other[at] {
			return fmt.Sprintf("first difference at byte %d", at)
		}
	}
	if len(one) == len(other) {
		return "no difference"
	}
	return "one is a prefix of the other"
}
