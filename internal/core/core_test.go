package core

import (
	"fmt"
	"strings"
	"sync"
	"testing"
)

const emptyScene = `{"version":1,"elements":[]}`

const unparsableScene = `{ not json`

func TestParseAnswersWhatTheParserSays(t *testing.T) {
	session, err := Open()
	if err != nil {
		t.Fatal(err)
	}

	valid, err := session.Parse([]byte(emptyScene))
	if err != nil {
		t.Fatalf("parse a Scene: %v", err)
	}
	if !valid.OK || valid.ExitCode != 0 {
		t.Fatalf("a Scene the parser takes answered ok=%v exit=%d", valid.OK, valid.ExitCode)
	}
	if len(valid.Problems) != 0 || len(valid.Notes) != 0 {
		t.Fatalf("a Scene the parser takes answered %v, %v", valid.Problems, valid.Notes)
	}

	broken, err := session.Parse([]byte(unparsableScene))
	if err != nil {
		t.Fatalf("parse a Scene that will not parse: %v", err)
	}
	if broken.OK {
		t.Fatal("a Scene that will not parse answered ok")
	}
	if broken.ExitCode != 3 {
		t.Fatalf("a Scene that will not parse exits %d, and `ez check` exits 3", broken.ExitCode)
	}
	if len(broken.Problems) == 0 {
		t.Fatal("a Scene that will not parse said nothing about why")
	}

	checked, err := Check([]byte(unparsableScene), CheckOptions{})
	if err != nil {
		t.Fatalf("check: %v", err)
	}
	if checked.ExitCode != broken.ExitCode || !sameLines(checked.Problems, broken.Problems) {
		t.Fatalf("check answered exit %d %v, parse answered exit %d %v",
			checked.ExitCode, checked.Problems, broken.ExitCode, broken.Problems)
	}
}

// goja's built-in JSON.parse replaces lone surrogate escapes with U+FFFD instead
// of preserving the code unit as V8 does.
const loneSurrogateScene = `{"version":1,"elements":[{"id":"a","type":"rectangle","x":0,"y":0,"width":100,"height":50,"label":"before\ud800after"}]}`

func TestCheckKeepsALoneSurrogateEscape(t *testing.T) {
	checked, err := Check([]byte(loneSurrogateScene), CheckOptions{})
	if err != nil {
		t.Fatal(err)
	}

	want := []string{"a: label must not contain characters XML cannot represent"}
	if checked.OK || checked.ExitCode != 3 || !sameLines(checked.Problems, want) {
		t.Fatalf("a Scene with a lone surrogate answered ok=%v exit=%d %v, want exit 3 %v",
			checked.OK, checked.ExitCode, checked.Problems, want)
	}
}

// goja's built-in JSON.parse rejects float64-overflowing numbers instead of
// reading Infinity as V8 does.
const overflowingNumberScene = `{"version":1,"elements":[{"id":"a","type":"rectangle","x":1e400,"y":0,"width":100,"height":50,"label":"big"}]}`

func TestCheckReadsANumberTooLargeForAFloat64AsV8Does(t *testing.T) {
	checked, err := Check([]byte(overflowingNumberScene), CheckOptions{})
	if err != nil {
		t.Fatal(err)
	}

	want := []string{"a: x must be a finite number, got null"}
	if checked.OK || checked.ExitCode != 3 || !sameLines(checked.Problems, want) {
		t.Fatalf("a Scene with a number too large for a float64 answered ok=%v exit=%d %v, want exit 3 %v",
			checked.OK, checked.ExitCode, checked.Problems, want)
	}
}

func TestWarmSessionAnswersLikeFreshRuntimes(t *testing.T) {
	session, err := Open()
	if err != nil {
		t.Fatal(err)
	}
	commands := []struct {
		name   string
		source string
	}{
		{"a Scene", emptyScene},
		{"a Scene that will not parse", unparsableScene},
		{"the Scene again", emptyScene},
		{"another Scene that will not parse", unparsableScene},
		{"a Scene that names what is wrong", `{"version":1,"elements":[{"id":"a"}]}`},
		{"a Scene", emptyScene},
	}
	for _, command := range commands {
		warm, err := session.Parse([]byte(command.source))
		if err != nil {
			t.Fatalf("%s in the session: %v", command.name, err)
		}
		fresh, err := Open()
		if err != nil {
			t.Fatal(err)
		}
		alone, err := fresh.Parse([]byte(command.source))
		if err != nil {
			t.Fatalf("%s in a runtime of its own: %v", command.name, err)
		}
		if warm.OK != alone.OK || warm.ExitCode != alone.ExitCode ||
			!sameLines(warm.Problems, alone.Problems) || !sameLines(warm.Notes, alone.Notes) {
			t.Fatalf("%s: the session answered ok=%v exit=%d %v; a runtime of its own answered ok=%v exit=%d %v",
				command.name, warm.OK, warm.ExitCode, warm.Problems, alone.OK, alone.ExitCode, alone.Problems)
		}
	}
}

func BenchmarkParse(b *testing.B) {
	source := writtenScene(200)
	b.Run("warm", func(b *testing.B) {
		session, err := Open()
		if err != nil {
			b.Fatal(err)
		}
		for b.Loop() {
			if _, err := session.Parse(source); err != nil {
				b.Fatal(err)
			}
		}
	})
	b.Run("once", func(b *testing.B) {
		for b.Loop() {
			if _, err := Check(source, CheckOptions{}); err != nil {
				b.Fatal(err)
			}
		}
	})
}

func writtenScene(elements int) []byte {
	var source strings.Builder
	source.WriteString(`{"version":1,"elements":[`)
	for index := range elements {
		if index > 0 {
			source.WriteString(",")
		}
		fmt.Fprintf(&source,
			`{"id":"r%d","type":"rectangle","x":%d,"y":%d,"width":120,"height":60,"label":"label %d"}`,
			index, (index%10)*40, (index/10)*40, index)
	}
	source.WriteString(`]}`)
	return []byte(source.String())
}

func TestSessionAnswersOneCommandAtATime(t *testing.T) {
	session, err := Open()
	if err != nil {
		t.Fatal(err)
	}
	const runs = 4
	sources := []string{emptyScene, unparsableScene}
	var wait sync.WaitGroup
	failures := make(chan string, runs*len(sources))
	for range runs {
		for _, source := range sources {
			wait.Add(1)
			go func() {
				defer wait.Done()
				answer, err := session.Parse([]byte(source))
				if err != nil {
					failures <- err.Error()
					return
				}
				valid := source == emptyScene
				if answer.OK != valid {
					failures <- fmt.Sprintf("a Scene answered ok=%v where its own runtime answers %v", answer.OK, valid)
				}
			}()
		}
	}
	wait.Wait()
	close(failures)
	for failure := range failures {
		t.Error(failure)
	}
}

func sameLines(one, other []string) bool {
	if len(one) != len(other) {
		return false
	}
	for index := range one {
		if one[index] != other[index] {
			return false
		}
	}
	return true
}
