package core

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

// answer is one command's answer, as `scripts/same-bytes.mjs` compares it. An
// empty list is `[]` rather than `null`, so both sides write the same shape, and
// a field the command did not make is `null`: `png` for `render` and `check`,
// `svg` for `png`.
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
// this writes and the script judges. `png` runs in both themes, because a
// rasteriser the SVG comparison cannot see and a theme that never arrived would
// both pass a single-theme comparison.
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
		fixture.Render = runAnswer(t, Render, source, "")
		fixture.Check = runAnswer(t, Check, source, "")
		fixture.PNGLight = runAnswer(t, Png, source, "light")
		fixture.PNGDark = runAnswer(t, Png, source, "dark")
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

// runAnswer runs one command, failing the test rather than writing a half answer
// the comparison would then have to explain.
func runAnswer(t *testing.T, command Command, source []byte, theme string) answer {
	t.Helper()
	ran, err := Run(command, source, Options{Theme: theme})
	if err != nil {
		t.Fatalf("%s: %v", command, err)
	}
	return answer{
		OK:       ran.OK,
		ExitCode: ran.ExitCode,
		SVG:      ran.SVG,
		PNG:      ran.PNG,
		Problems: listed(ran.Problems),
		Notes:    listed(ran.Notes),
	}
}

// listed answers an empty list as an empty list, never as null.
func listed(problems []string) []string {
	if problems == nil {
		return []string{}
	}
	return problems
}

// BenchmarkRenderEveryElement measures a cold Run: every iteration starts a goja
// runtime, as every `ez` command does.
func BenchmarkRenderEveryElement(b *testing.B) {
	source, err := os.ReadFile("../../test/fixtures/every-element.json")
	if err != nil {
		b.Fatal(err)
	}

	for b.Loop() {
		ran, err := Run(Render, source, Options{})
		if err != nil {
			b.Fatal(err)
		}
		if !ran.OK || ran.SVG == "" {
			b.Fatalf("render drew nothing: exit %d, %v", ran.ExitCode, ran.Problems)
		}
	}
}
