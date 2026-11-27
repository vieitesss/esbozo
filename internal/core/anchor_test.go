package core

import (
	"encoding/json"
	"testing"
)

// TestAnchorReplacesBrokenUtf8TheWayBufferDoes: a Scene file is UTF-8 text, and a
// Scene that is not is read as `Buffer.toString('utf8')` reads it — one U+FFFD for
// each maximal subpart of a sequence that encodes no character, so a truncated
// character counts once and a stray byte counts once. `anchor` writes that text
// back, so the file `ez anchor` writes has to be those bytes.
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
			edited, err := Anchor(sceneWithLabel(testCase.label), AnchorOptions{
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

// sceneWithLabel is that Scene: a box whose Label is `label`'s bytes as they are,
// and an arrow Snapped to it, so `anchor` has an Anchor to place.
func sceneWithLabel(label string) []byte {
	return []byte(`{"version":1,"elements":[` +
		`{"id":"box","type":"rectangle","x":40,"y":40,"width":120,"height":80,"label":"` + label + `"},` +
		`{"id":"arr","type":"arrow","points":[{"x":160,"y":80,"snap":"box"},{"x":260,"y":80}]}]}`)
}
