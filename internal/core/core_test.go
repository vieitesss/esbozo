package core

import (
	"os"
	"strings"
	"testing"
)

// TestRunRefusesACommandTheCoreDoesNotHave: `run` is where Go names a command,
// and the bundle answers a name it does not have with an error, so `ez` reports
// a core it could not run (exit 4) rather than a refusal about a Scene that
// nothing read (exit 3).
func TestRunRefusesACommandTheCoreDoesNotHave(t *testing.T) {
	source, err := os.ReadFile("../../test/fixtures/small.json")
	if err != nil {
		t.Fatal(err)
	}

	if _, err := run("publish", source, nil); err == nil {
		t.Fatal("run answered a command the core does not have")
	} else if !strings.Contains(err.Error(), "publish") {
		t.Errorf("the error does not name the command it refused: %v", err)
	}
}
