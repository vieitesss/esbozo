package core

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

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
	session := openSession(t)
	for _, path := range paths {
		source, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		fixture := fixtureAnswers{Fixture: filepath.Base(path)}
		fixture.Render = renderAnswer(t, session, source)
		fixture.Check = checkAnswer(t, session, source)
		fixture.PNGLight = pngAnswer(t, session, source, "light")
		fixture.PNGDark = pngAnswer(t, session, source, "dark")
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

func renderAnswer(t *testing.T, session *Session, source []byte) answer {
	t.Helper()
	rendered, err := session.Render(source, RenderOptions{})
	if err != nil {
		t.Fatalf("render: %v", err)
	}
	written := answered(rendered.Result)
	written.SVG = rendered.SVG
	return written
}

func checkAnswer(t *testing.T, session *Session, source []byte) answer {
	t.Helper()
	checked, err := session.Check(source, CheckOptions{})
	if err != nil {
		t.Fatalf("check: %v", err)
	}
	return answered(checked)
}

func pngAnswer(t *testing.T, session *Session, source []byte, theme string) answer {
	t.Helper()
	image, err := session.PNG(source, PNGOptions{Theme: theme})
	if err != nil {
		t.Fatalf("png %s: %v", theme, err)
	}
	written := answered(image.Result)
	written.PNG = image.PNG
	return written
}

func answered(result Result) answer {
	return answer{
		OK:       result.OK,
		ExitCode: result.ExitCode,
		Problems: nonNilSlice(result.Problems),
		Notes:    nonNilSlice(result.Notes),
	}
}

func nonNilSlice(items []string) []string {
	if items == nil {
		return []string{}
	}
	return items
}

func BenchmarkRenderEveryElement(b *testing.B) {
	source, err := os.ReadFile("../../test/fixtures/every-element.json")
	if err != nil {
		b.Fatal(err)
	}

	for b.Loop() {
		session := openSession(b)
		rendered, err := session.Render(source, RenderOptions{})
		if err != nil {
			b.Fatal(err)
		}
		if !rendered.OK || rendered.SVG == "" {
			b.Fatalf("render drew nothing: exit %d, %v", rendered.ExitCode, rendered.Problems)
		}
	}
}
