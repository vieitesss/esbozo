package core

import (
	"testing"

	"github.com/dop251/goja"

	"esbozo"
)

// TestBundleRunsTwiceInOneRuntime is what a host that keeps a runtime asks of
// the bundle: evaluating it again in the same realm leaves the global scope as
// it found it.
//
// `ez serve` will hold one runtime and run the bundle behind a lock, and a
// second evaluation is how a hosted bundle is reloaded. The bundle's own bodies
// are an IIFE, so the only top-level bindings are the banner's: a `let` or
// `const` there is a name the realm already has on the second run, and a
// `SyntaxError` instead of a core.
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
