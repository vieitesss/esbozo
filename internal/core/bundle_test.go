package core

import (
	"testing"

	"github.com/dop251/goja"

	"esbozo"
)

// TestBundleRunsTwiceInOneRuntime pins that a second evaluation in one realm
// leaves the global scope as it found it: the banner runs there, so a `let` or
// `const` at its top would be a name the realm already has, and a `SyntaxError`
// instead of a core.
func TestBundleRunsTwiceInOneRuntime(t *testing.T) {
	vm := goja.New()
	if err := installHost(vm); err != nil {
		t.Fatal(err)
	}
	program, err := goja.Compile("core.js", string(esbozo.CoreBundle), false)
	if err != nil {
		t.Fatalf("the core bundle does not compile: %v", err)
	}

	for run := 1; run <= 2; run++ {
		if _, err := vm.RunProgram(program); err != nil {
			t.Fatalf("run %d of the bundle in one runtime: %v", run, err)
		}
	}
}
