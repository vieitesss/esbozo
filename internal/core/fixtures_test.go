package core

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

// answer is one command's answer, as `scripts/same-bytes.mjs` compares it. An
// empty list is `[]` rather than `null`, so both sides write the same JSON, and
// a field the command did not make is empty: `png` is `null` for `render` and
// `check`, and `svg` is `""` for `png`.
type answer struct {
	OK       bool     `json:"ok"`
	ExitCode int      `json:"exitCode"`
	SVG      string   `json:"svg"`
	PNG      []byte   `json:"png"`
	Problems []string `json:"problems"`
	Notes    []string `json:"notes"`
}

type fixtureAnswers struct {
	Fixture  string `json:"fixture"`
	Render   answer `json:"render"`
	Check    answer `json:"check"`
	PNGLight answer `json:"pngLight"`
	PNGDark  answer `json:"pngDark"`
}

type answers struct {
	Fixtures []fixtureAnswers `json:"fixtures"`
}

// TestCoreAnswers writes what the Go core answers for every fixture Scene, for
// `scripts/same-bytes.mjs` to hold to what the same bundle answers in Node. The
// two halves stay two halves — one runtime cannot be compared with itself — so
// this writes and the script judges. `png` runs in both themes: a rasteriser the
// SVG comparison cannot see, and a theme that never arrived, would both pass a
// single-theme comparison.
func TestCoreAnswers(t *testing.T) {
	out := os.Getenv("EZ_SAME_BYTES_OUT")
	if out == "" {
		t.Skip("EZ_SAME_BYTES_OUT is unset: scripts/same-bytes.mjs sets it and compares")
	}

	paths, err := filepath.Glob("../../test/fixtures/*.json")
	if err != nil {
		t.Fatal(err)
	}
	if len(paths) == 0 {
		t.Fatal("no fixture Scenes: the comparison would compare nothing")
	}

	written := answers{}
	for _, path := range paths {
		source, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		fixture := fixtureAnswers{Fixture: filepath.Base(path)}
		fixture.Render = renderAnswer(t, source)
		fixture.Check = checkAnswer(t, source)
		fixture.PNGLight = pngAnswer(t, source, "light")
		fixture.PNGDark = pngAnswer(t, source, "dark")
		written.Fixtures = append(written.Fixtures, fixture)
	}

	encoded, err := json.Marshal(written)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(out, encoded, 0o644); err != nil {
		t.Fatal(err)
	}
}

// renderAnswer runs `render`, failing the test rather than writing a half answer
// the comparison would then have to explain.
func renderAnswer(t *testing.T, source []byte) answer {
	t.Helper()
	rendered, err := Render(source, RenderOptions{})
	if err != nil {
		t.Fatalf("render: %v", err)
	}
	written := answered(rendered.Result)
	written.SVG = rendered.SVG
	return written
}

// checkAnswer runs `check`, which writes no file: its answer is the lines it
// refuses with.
func checkAnswer(t *testing.T, source []byte) answer {
	t.Helper()
	checked, err := Check(source, CheckOptions{})
	if err != nil {
		t.Fatalf("check: %v", err)
	}
	return answered(checked)
}

// pngAnswer runs `png` in one theme.
func pngAnswer(t *testing.T, source []byte, theme string) answer {
	t.Helper()
	image, err := PNG(source, PNGOptions{Theme: theme})
	if err != nil {
		t.Fatalf("png %s: %v", theme, err)
	}
	written := answered(image.Result)
	written.PNG = image.PNG
	return written
}

// answered is what every command answers, as the comparison writes it; each
// command's own field is set beside these.
func answered(result Result) answer {
	return answer{
		OK:       result.OK,
		ExitCode: result.ExitCode,
		Problems: listed(result.Problems),
		Notes:    listed(result.Notes),
	}
}

// listed answers an empty list as an empty list, never as null.
func listed(problems []string) []string {
	if problems == nil {
		return []string{}
	}
	return problems
}

// BenchmarkRenderEveryElement measures a cold Render: every iteration starts a
// goja runtime, as every `ez` command does, over the bundle compiled once.
func BenchmarkRenderEveryElement(b *testing.B) {
	source, err := os.ReadFile("../../test/fixtures/every-element.json")
	if err != nil {
		b.Fatal(err)
	}

	for b.Loop() {
		rendered, err := Render(source, RenderOptions{})
		if err != nil {
			b.Fatal(err)
		}
		if !rendered.OK || rendered.SVG == "" {
			b.Fatalf("render drew nothing: exit %d, %v", rendered.ExitCode, rendered.Problems)
		}
	}
}
