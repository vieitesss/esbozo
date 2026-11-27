package core

import (
	"os"
	"strings"
	"testing"
)

// TestRunRefusesACommandTheCoreDoesNotHave: `Run` answers a name the core does
// not have with an error, so `ez` reports a core it could not run (exit 4)
// rather than a refusal about a Scene that nothing read (exit 3).
func TestRunRefusesACommandTheCoreDoesNotHave(t *testing.T) {
	source, err := os.ReadFile("../../test/fixtures/small.json")
	if err != nil {
		t.Fatal(err)
	}

	answer, err := Run("publish", source, Options{})
	if err == nil {
		t.Fatalf("Run answered a command the core does not have: exit %d", answer.ExitCode)
	}
	if !strings.Contains(err.Error(), "publish") {
		t.Errorf("the error does not name the command it refused: %v", err)
	}
}
