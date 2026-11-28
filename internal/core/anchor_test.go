package core

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestAnchorReplacesBrokenUtf8TheWayBufferDoes(t *testing.T) {
	cases := []struct {
		name  string
		label string
		want  string
	}{
		{"a truncated three-byte character", "a\xE3\x80b", "a\uFFFDb"},
		{"a truncated four-byte character", "a\xF0\x9F\x98b", "a\uFFFDb"},
		{"a surrogate", "a\xED\xA0\x80b", "a\uFFFD\uFFFD\uFFFDb"},
		{"an overlong pair", "a\xC0\xAFb", "a\uFFFD\uFFFDb"},
		{"a character above the last code point", "a\xF4\x90\x80\x80b", "a\uFFFD\uFFFD\uFFFD\uFFFDb"},
		{"a continuation byte the lead will not take", "a\xE0\x80b", "a\uFFFD\uFFFDb"},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			edited, err := Anchor(AnchorOptions{
				ScenePath: sceneFile(t, sceneWithLabel(testCase.label)),
				ElementID: "arr",
				End:       "start",
				Place:     "right",
			})
			if err != nil {
				t.Fatalf("anchor: %v", err)
			}
			if !edited.OK {
				t.Fatalf("anchor refused the Scene: %v", edited.Problems)
			}

			var written struct {
				Elements []struct {
					Label string `json:"label"`
				} `json:"elements"`
			}
			if err := json.Unmarshal([]byte(edited.Scene), &written); err != nil {
				t.Fatalf("the Scene anchor saved does not parse: %v", err)
			}
			if got := written.Elements[0].Label; got != testCase.want {
				t.Errorf("the Label saved is %q, want %q", got, testCase.want)
			}
		})
	}
}

func TestAnEmptyScenePathReadsNoFile(t *testing.T) {
	folder := t.TempDir()
	// A file named "null" is what a host opens when an empty path is mistaken
	// for no path at all and stringified.
	untouched := sceneWithLabel("untouched")
	if err := os.WriteFile(filepath.Join(folder, "null"), untouched, 0o644); err != nil {
		t.Fatal(err)
	}
	t.Chdir(folder)

	cases := []struct {
		name string
		edit func() (Edited, error)
	}{
		{"anchor", func() (Edited, error) {
			return Anchor(AnchorOptions{All: true})
		}},
		{"snap", func() (Edited, error) {
			return Snap(SnapOptions{ElementID: "arr", End: "start", Target: "off"})
		}},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			edited, err := testCase.edit()
			if err != nil {
				t.Fatalf("%s: %v", testCase.name, err)
			}
			if edited.OK || edited.ExitCode != ExitInvalidScene {
				t.Errorf("%s answered ok=%v exit=%d, want ok=false exit=%d",
					testCase.name, edited.OK, edited.ExitCode, ExitInvalidScene)
			}
			if len(edited.Problems) != 1 || !strings.HasPrefix(edited.Problems[0], "cannot read Scene : ") {
				t.Errorf("%s answered problems %q, want one cannot read Scene line",
					testCase.name, edited.Problems)
			}
			got, err := os.ReadFile(filepath.Join(folder, "null"))
			if err != nil {
				t.Fatal(err)
			}
			if !bytes.Equal(got, untouched) {
				t.Errorf("%s wrote the file named null: %s", testCase.name, got)
			}
		})
	}
}

// An empty word is a word: it arrives at the core as null because the runner
// reads "" that way, and Snap judges it as the empty word that was typed.
func TestSnapJudgesAnEmptyWordAsTheEmptyWord(t *testing.T) {
	cases := []struct {
		name     string
		options  SnapOptions
		exitCode int
		problem  string
	}{
		{
			"an empty target",
			SnapOptions{ElementID: "arr", End: "start", Target: ""},
			ExitInvalidScene,
			`no Element "" in the Scene`,
		},
		{
			"an empty Element",
			SnapOptions{ElementID: "", End: "start", Target: "box"},
			ExitInvalidScene,
			`no Element "" in the Scene`,
		},
		{
			"an empty end",
			SnapOptions{ElementID: "arr", End: "", Target: "box"},
			ExitUsage,
			`an end is start or end, got ""`,
		},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			source := sceneWithLabel("untouched")
			path := sceneFile(t, source)
			options := testCase.options
			options.ScenePath = path

			edited, err := Snap(options)
			if err != nil {
				t.Fatalf("snap: %v", err)
			}
			if edited.OK || edited.ExitCode != testCase.exitCode {
				t.Errorf("snap answered ok=%v exit=%d, want ok=false exit=%d",
					edited.OK, edited.ExitCode, testCase.exitCode)
			}
			if len(edited.Problems) != 1 || edited.Problems[0] != testCase.problem {
				t.Errorf("snap answered problems %q, want one %q", edited.Problems, testCase.problem)
			}
			got, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			if !bytes.Equal(got, source) {
				t.Errorf("snap wrote the Scene it refused: %s", got)
			}
		})
	}
}

// sceneFile writes a Scene to a temporary folder, and answers its path.
func sceneFile(t *testing.T, source []byte) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "scene.json")
	if err := os.WriteFile(path, source, 0o644); err != nil {
		t.Fatal(err)
	}
	return path
}

func sceneWithLabel(label string) []byte {
	return []byte(`{"version":1,"elements":[` +
		`{"id":"box","type":"rectangle","x":40,"y":40,"width":120,"height":80,"label":"` + label + `"},` +
		`{"id":"arr","type":"arrow","points":[{"x":160,"y":80,"snap":"box"},{"x":260,"y":80}]}]}`)
}
