package core

import (
	"maps"
	"os"
	"slices"
	"strings"
	"testing"
)

// TestHostTableAnswersEveryMethodEzHostDeclares keeps the two halves of the host
// seam in step: `ez` answers the nine names src/core-host.ts declares, and no
// other. A method added on either side reddens this before it reaches the core.
func TestHostTableAnswersEveryMethodEzHostDeclares(t *testing.T) {
	declared := ezHostMethodNames(t)
	answered := slices.Sorted(maps.Keys(hostMethods))

	if !slices.Equal(declared, answered) {
		t.Fatalf("src/core-host.ts declares EzHost%s, and hostMethods answers %s", declared, answered)
	}
}

// ezHostMethodNames reads the methods of EzHost in src/core-host.ts, sorted.
func ezHostMethodNames(t *testing.T) []string {
	t.Helper()

	source, err := os.ReadFile("../../src/core-host.ts")
	if err != nil {
		t.Fatalf("read the host seam: %v", err)
	}

	declared := []string{}
	inside := false
	for _, line := range strings.Split(string(source), "\n") {
		switch {
		case strings.HasPrefix(line, "export interface EzHost {"):
			inside = true
		case inside && line == "}":
			inside = false
		case inside:
			if name, _, found := strings.Cut(strings.TrimSpace(line), "("); found {
				declared = append(declared, name)
			}
		}
	}
	if len(declared) == 0 {
		t.Fatal("src/core-host.ts declares no EzHost method: the seam moved or was renamed")
	}

	slices.Sort(declared)
	return declared
}
