// Package core runs the bundled TypeScript core in goja, so that a Scene is
// parsed, measured and drawn by the same code the CLI and the editor run.
//
// The boundary is the one ADR 0003 draws: Go passes a Scene's bytes and the
// paths `--font` and `--css` name, and reads back either SVG text or the lines
// `ez` prints. No Scene rule lives on this side.
package core

import (
	"fmt"

	"github.com/dop251/goja"
)

// Answer is what `ez render` or `ez check` made.
type Answer struct {
	// OK is whether the command succeeded; when it is false, ExitCode says why.
	OK bool
	// ExitCode is the code `ez` exits with, as `EXIT` in the TS CLI defines it.
	ExitCode int
	// SVG is the rendering `render` wrote, and is empty for `check`.
	SVG string
	// Problems are the lines `ez` prints on stderr when it refuses.
	Problems []string
	// Notes are lines it prints without failing, such as a remote font warning.
	Notes []string
}

// Options are the flags a command was given; an empty field is a flag that was
// not given.
type Options struct {
	// FontPath is `--font`: the font to measure and draw with.
	FontPath string
	// CSSPath is `--css`: the stylesheet the palette and the font come from.
	CSSPath string
}

// Run answers one command over a Scene's bytes: `render` for the SVG text,
// `check` for the overflow lines.
func Run(kind string, source []byte, options Options) (Answer, error) {
	vm, err := newRuntime()
	if err != nil {
		return Answer{}, err
	}

	request := vm.NewObject()
	if err := request.Set("source", vm.NewArrayBuffer(source)); err != nil {
		return Answer{}, err
	}
	if err := request.Set("fontPath", optional(options.FontPath)); err != nil {
		return Answer{}, err
	}
	if err := request.Set("cssPath", optional(options.CSSPath)); err != nil {
		return Answer{}, err
	}
	if err := vm.Set("__ezRequest", request); err != nil {
		return Answer{}, err
	}

	// Two calls, not one: goja runs the queue of promises when the script that
	// awaited them ends, so `begin` settles the answer and `answer` reads it.
	if _, err := vm.RunString(fmt.Sprintf(`__ezCore.begin(__ezRequest, %q)`, kind)); err != nil {
		return Answer{}, err
	}
	value, err := vm.RunString(`__ezCore.answer()`)
	if err != nil {
		return Answer{}, err
	}
	return answerOf(value)
}

// optional turns an absent flag into the null the core tests for.
func optional(path string) interface{} {
	if path == "" {
		return nil
	}
	return path
}

func answerOf(value goja.Value) (Answer, error) {
	object, ok := value.(*goja.Object)
	if !ok {
		return Answer{}, fmt.Errorf("the core answered with %s, not an object", value.ExportType())
	}
	return Answer{
		OK:       object.Get("ok").ToBoolean(),
		ExitCode: int(object.Get("exitCode").ToInteger()),
		SVG:      object.Get("svg").String(),
		Problems: linesOf(object.Get("problems")),
		Notes:    linesOf(object.Get("notes")),
	}, nil
}

// linesOf reads a JS array of strings as Go strings.
func linesOf(value goja.Value) []string {
	object, ok := value.(*goja.Object)
	if !ok {
		return nil
	}
	length := int(object.Get("length").ToInteger())
	lines := make([]string, 0, length)
	for index := range length {
		lines = append(lines, object.Get(fmt.Sprintf("%d", index)).String())
	}
	return lines
}
