package core

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

// answer is one command's answer, as `scripts/same-bytes.mjs` compares it. An
// empty list is `[]` rather than `null`, so both sides write the same shape.
type answer struct {
	OK       bool     `json:"ok"`
	ExitCode int      `json:"exitCode"`
	SVG      string   `json:"svg"`
	Problems []string `json:"problems"`
	Notes    []string `json:"notes"`
}

// fixtureAnswers is one Scene answered by both commands.
type fixtureAnswers struct {
	Fixture string `json:"fixture"`
	Render  answer `json:"render"`
	Check   answer `json:"check"`
}

// answers is what this test writes, in the order the fixtures are read.
type answers struct {
	Fixtures []fixtureAnswers `json:"fixtures"`
}

// TestCoreAnswers writes what the Go core answers for every fixture Scene.
//
// `scripts/same-bytes.mjs` is the comparison: it renders and checks the same
// Scenes in Node with the same bundle, and holds the SVG bytes, the problem
// lines, the notes and the exit codes to these. The two halves have to stay two
// halves — one runtime cannot be compared with itself — so this writes and the
// script judges.
//
// Without `EZ_SAME_BYTES_OUT` there is nothing to write to, and the script that
// sets it is the only caller that can judge the result.
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
		fixture.Render = runAnswer(t, Render, source)
		fixture.Check = runAnswer(t, Check, source)
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
func runAnswer(t *testing.T, command Command, source []byte) answer {
	t.Helper()
	ran, err := Run(command, source, Options{})
	if err != nil {
		t.Fatalf("%s: %v", command, err)
	}
	return answer{
		OK:       ran.OK,
		ExitCode: ran.ExitCode,
		SVG:      ran.SVG,
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

// BenchmarkRenderEveryElement is what one command costs with nothing warm: Run
// starts a goja runtime each time, so every iteration pays the cold start the
// binary pays. It is the measurement `ez`'s cost is reported from, and it needs
// the built bundle, like every other test in this package.
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
