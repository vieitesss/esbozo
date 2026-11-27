package core

import (
	"fmt"
	"sync"
	"testing"
)

// A Scene the parser takes: `docs/save-api.md` writes it as the empty Scene.
const emptyScene = `{"version":1,"elements":[]}`

// A Scene the parser refuses, and why it does.
const unparsableScene = `{ not json`

// TestParseAnswersWhatTheParserSays holds parsing to the one thing it is: the
// parser `ez check` uses, with no font measured and no Label fitted. A Scene it
// takes is the whole of a valid answer, and a Scene it refuses carries the lines
// `ez check` prints for one, so a host can tell a Scene from any other JSON.
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

	// `check` refuses an invalid Scene at the same place and with the same lines,
	// so a parser that drifted from it would answer a different Scene's problem.
	checked, err := Check([]byte(unparsableScene), CheckOptions{})
	if err != nil {
		t.Fatalf("check: %v", err)
	}
	if checked.ExitCode != broken.ExitCode || !sameLines(checked.Problems, broken.Problems) {
		t.Fatalf("check answered exit %d %v, parse answered exit %d %v",
			checked.ExitCode, checked.Problems, broken.ExitCode, broken.Problems)
	}
}

// TestWarmSessionAnswersLikeFreshRuntimes holds one runtime used over and over to
// what a runtime of its own answers each time: a session is a way to skip the
// start-up cost, never a pair of hands that remembers the last command.
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

// TestSessionAnswersOneCommandAtATime is the lock: many commands over one session
// answer what each would answer alone. Run it with `-race`.
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

// sameLines is whether two answers carry the same lines, empty and nil alike.
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
