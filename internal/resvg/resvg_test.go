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

const optionsJSON = `{"background":"rgb(255,255,248)","fitTo":{"mode":"original"}}`

func TestRasteriseMatchesTheModule(t *testing.T) {
	want := triangle(t)

	got, err := Rasterise(triangleSVG(t), optionsJSON)
	if err != nil {
		t.Fatalf("cannot rasterise: %v", err)
	}
	if !bytes.Equal(got, want) {
		t.Fatalf("PNG %d bytes, Node's %d; %s", len(got), len(want), firstDifference(got, want))
	}
}

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

func triangleSVG(t *testing.T) string {
	t.Helper()
	svg, err := os.ReadFile("testdata/triangle.svg")
	if err != nil {
		t.Fatal(err)
	}
	return string(svg)
}

func triangle(t *testing.T) []byte {
	t.Helper()
	png, err := os.ReadFile("testdata/triangle.png")
	if err != nil {
		t.Fatal(err)
	}
	return png
}

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

func TestRasteriseReportsATrapInOneLine(t *testing.T) {
	const huge = `<svg xmlns="http://www.w3.org/2000/svg" width="100000" height="100000"` +
		` viewBox="0 0 100000 100000"><rect x="2" y="2" width="44" height="20" fill="#123456"/></svg>`

	// Use a dedicated rasteriser: a trap in resvg's allocator poisons the wasm module instance.
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

func TestRasterisePastABrokenCache(t *testing.T) {
	want := triangle(t)

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
