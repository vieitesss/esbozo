package core

import (
	"os"
	"strings"
	"testing"
)

// TestRunRefusesACommandTheCoreDoesNotHave is the host's half of the boundary:
// `Run` names the two commands `ez` has, and answers any other with an error, so
// `ez` reports a core it could not run (exit 4) rather than a refusal about a
// Scene that nothing read, printed with exit 3. The bundle refuses an unknown
// kind as well; `test/core-entry.test.ts` holds that half.
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
