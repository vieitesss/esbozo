package resvg

import (
	"bytes"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// The options `src/png.ts` hands resvg: the Scene's paper as the background, no
// scaling, spelled out as JSON so the test goes in through the same door the core
// does.
const optionsJSON = `{"background":"rgb(255,255,248)","fitTo":{"mode":"original"}}`

// TestRasteriseMatchesTheNodeModule: the PNG has to be the module's own bytes.
//
// `testdata/triangle.png` was written by the real `@resvg/resvg-wasm` in Node from
// `testdata/triangle.svg` and `optionsJSON`, so this compares against what the CLI
// gets for free rather than a hash this package made itself.
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

// TestRasteriseRefusesAndRecovers: the module is started once and reused, so an
// SVG resvg cannot parse must come back as its own message, and the next Scene
// must still draw. A call sequence that leaves the heap or the shadow stack dirty
// would pass the test above and fail here.
func TestRasteriseRefusesAndRecovers(t *testing.T) {
	want := triangle(t)

	if _, err := Rasterise("this is not an SVG", optionsJSON); err == nil {
		t.Fatal("resvg accepted an input that is not an SVG")
	} else if err.Error() == "" {
		t.Fatal("resvg refused the SVG without a message")
	}

	got, err := Rasterise(triangleSVG(t), optionsJSON)
	if err != nil {
		t.Fatalf("cannot rasterise after a refusal: %v", err)
	}
	if !bytes.Equal(got, want) {
		t.Fatalf("PNG after a refusal is %d bytes, Node's %d; %s", len(got), len(want), firstDifference(got, want))
	}
}

// triangleSVG is the SVG `testdata/triangle.png` was made from.
func triangleSVG(t *testing.T) string {
	t.Helper()
	svg, err := os.ReadFile("testdata/triangle.svg")
	if err != nil {
		t.Fatal(err)
	}
	return string(svg)
}

// triangle is that SVG as Node's module wrote it.
func triangle(t *testing.T) []byte {
	t.Helper()
	png, err := os.ReadFile("testdata/triangle.png")
	if err != nil {
		t.Fatal(err)
	}
	return png
}

// TestRasteriseWithoutAWritableCache: a cache directory that cannot exist must
// cost seconds, never the PNG, so `ez png` draws on a machine whose home is
// read-only. wazero fails the compile outright when it cannot save its result, so
// an unwritable cache has to be given up before the compile rather than by it.
func TestRasteriseWithoutAWritableCache(t *testing.T) {
	blocked := filepath.Join(t.TempDir(), "cache")
	if err := os.WriteFile(blocked, nil, 0o600); err != nil {
		t.Fatal(err)
	}

	one, err := newRasteriser(filepath.Join(blocked, "wazero"))
	if err != nil {
		t.Fatalf("a cache directory that cannot exist stops the rasteriser: %v", err)
	}
	defer func() { _ = one.runtime.Close(one.ctx) }()
	got, err := one.rasterise(triangleSVG(t), optionsJSON)
	if err != nil {
		t.Fatalf("cannot rasterise without a cache: %v", err)
	}
	if want := triangle(t); !bytes.Equal(got, want) {
		t.Fatalf("PNG %d bytes, Node's %d; %s", len(got), len(want), firstDifference(got, want))
	}
}

// TestRasteriseReportsATrapInOneLine: resvg's module traps when its canvas cannot
// be held, and `ez png` prints the reason as one line. wazero appends its own wasm
// stack trace to a trap — the module's frames, worth nothing to someone whose Scene
// is simply too big — so that goes.
func TestRasteriseReportsATrapInOneLine(t *testing.T) {
	// 100,000² px is 40 GB of canvas: resvg's allocator gives up, and the module
	// traps on the unreachable that failure leaves it in.
	const huge = `<svg xmlns="http://www.w3.org/2000/svg" width="100000" height="100000"` +
		` viewBox="0 0 100000 100000"><rect x="2" y="2" width="44" height="20" fill="#123456"/></svg>`

	// A rasteriser of this test's own: resvg's allocator stays broken once it has
	// given up, so this is the last PNG this module draws.
	one, err := newRasteriser("")
	if err != nil {
		t.Fatalf("cannot start the rasteriser: %v", err)
	}
	defer func() { _ = one.runtime.Close(one.ctx) }()

	if _, err := one.rasterise(huge, optionsJSON); err == nil {
		t.Fatal("resvg drew a 100,000 × 100,000 canvas")
	} else if strings.Contains(err.Error(), "\n") {
		t.Fatalf("the trap reaches the CLI over several lines: %v", err)
	}
}

// TestRasterisePastABrokenCache: a cache entry wazero cannot read costs the
// seconds it was meant to save, never the PNG, and the user never has to delete
// it by hand. A crash mid-write leaves an entry truncated; something else in the
// cache directory leaves it nonsense.
func TestRasterisePastABrokenCache(t *testing.T) {
	want := triangle(t)

	// One real cold start, so the broken entries below are wazero's own work in the
	// places wazero puts them.
	cached := filepath.Join(t.TempDir(), "wazero")
	one, err := newRasteriser(cached)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := one.rasterise(triangleSVG(t), optionsJSON); err != nil {
		t.Fatalf("cannot warm the cache: %v", err)
	}
	if err := one.runtime.Close(one.ctx); err != nil {
		t.Fatal(err)
	}

	for _, broken := range []struct {
		name     string
		contents []byte
	}{
		{"truncated", nil},
		{"garbage", []byte("CORRUPTED_WAZERO_CACHE")},
	} {
		t.Run(broken.name, func(t *testing.T) {
			start, err := newRasteriser(brokenCache(t, cached, broken.contents))
			if err != nil {
				t.Fatalf("a broken cache entry stops the rasteriser: %v", err)
			}
			defer func() { _ = start.runtime.Close(start.ctx) }()

			got, err := start.rasterise(triangleSVG(t), optionsJSON)
			if err != nil {
				t.Fatalf("cannot rasterise past a broken cache entry: %v", err)
			}
			if !bytes.Equal(got, want) {
				t.Fatalf("PNG %d bytes, Node's %d; %s", len(got), len(want), firstDifference(got, want))
			}
		})
	}
}

// brokenCache is a copy of the cache at root, its every entry holding contents.
func brokenCache(t *testing.T, root string, contents []byte) string {
	t.Helper()
	saved := entries(t, root)
	if len(saved) == 0 {
		t.Fatal("the warm cache saved nothing to break")
	}
	dir := t.TempDir()
	for _, entry := range saved {
		target := filepath.Join(dir, entry)
		if err := os.MkdirAll(filepath.Dir(target), 0o700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(target, contents, 0o600); err != nil {
			t.Fatal(err)
		}
	}
	return dir
}

// entries is every file saved under root, as a path relative to it.
func entries(t *testing.T, root string) []string {
	t.Helper()
	var saved []string
	err := filepath.WalkDir(root, func(path string, entry fs.DirEntry, err error) error {
		if err != nil || entry.IsDir() {
			return err
		}
		relative, err := filepath.Rel(root, path)
		if err != nil {
			return err
		}
		saved = append(saved, relative)
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	return saved
}

// firstDifference says where two byte strings part company.
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
