// Package core runs the bundled TypeScript core in goja, so that a Scene is
// parsed, measured and drawn by the same code the CLI and the editor run.
//
// No Scene rule lives on this side: Go passes a Scene's bytes and the paths
// `--font` and `--css` name, and reads back either SVG text or the lines `ez`
// prints.
package core

import (
	"fmt"

	"github.com/dop251/goja"
)

// Answer is what `ez render`, `ez check` or `ez png` made.
type Answer struct {
	// OK is whether the command succeeded; when it is false, ExitCode says why.
	OK bool
	// ExitCode is the code `ez` exits with, as `EXIT` in the TS CLI defines it.
	ExitCode int
	// SVG is the rendering `render` wrote, and is empty for `check` and `png`.
	SVG string
	// PNG is the image `png` drew, and is nil for any other command.
	PNG []byte
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
	// Theme is `--theme`: the palette `png` draws in, `light` or `dark`.
	Theme string
	// Ink, Paper and Muted are `--ink`, `--paper` and `--muted`: the colours
	// `png` draws with, overriding what the stylesheet or the built-in theme
	// declares.
	Ink   string
	Paper string
	Muted string
}

// Command is a command the core runs, as `begin` in `src/core-entry.ts` takes
// it; `Run` refuses a name the core does not have rather than passing it on.
type Command string

const (
	// Render is `ez render`: the SVG the Scene draws to.
	Render Command = "render"
	// Check is `ez check`: the lines a Scene's Labels overflow with.
	Check Command = "check"
	// PNG is `ez png`: the image the Scene draws to, in one theme.
	PNG Command = "png"
)

// Run answers one command over a Scene's bytes.
func Run(command Command, source []byte, options Options) (Answer, error) {
	if command != Render && command != Check && command != PNG {
		return Answer{}, fmt.Errorf("the core has no command %q", command)
	}

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
	if err := request.Set("theme", optional(options.Theme)); err != nil {
		return Answer{}, err
	}
	if err := request.Set("ink", optional(options.Ink)); err != nil {
		return Answer{}, err
	}
	if err := request.Set("paper", optional(options.Paper)); err != nil {
		return Answer{}, err
	}
	if err := request.Set("muted", optional(options.Muted)); err != nil {
		return Answer{}, err
	}

	// Two calls, not one: goja runs the queue of promises when the call that
	// awaited them ends, so `begin` settles the answer and `answer` reads it.
	begin, err := callableOf(vm, "begin")
	if err != nil {
		return Answer{}, err
	}
	if _, err := begin(goja.Undefined(), request, vm.ToValue(string(command))); err != nil {
		return Answer{}, err
	}
	answer, err := callableOf(vm, "answer")
	if err != nil {
		return Answer{}, err
	}
	value, err := answer(goja.Undefined())
	if err != nil {
		return Answer{}, err
	}
	return answerOf(value)
}

// callableOf is a function the bundle left on `__ezCore`.
func callableOf(vm *goja.Runtime, name string) (goja.Callable, error) {
	surface, ok := vm.Get("__ezCore").(*goja.Object)
	if !ok {
		return nil, fmt.Errorf("the core bundle left no __ezCore")
	}
	callable, ok := goja.AssertFunction(surface.Get(name))
	if !ok {
		return nil, fmt.Errorf("the core bundle has no __ezCore.%s", name)
	}
	return callable, nil
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
	answer := Answer{
		OK:       object.Get("ok").ToBoolean(),
		ExitCode: int(object.Get("exitCode").ToInteger()),
		SVG:      object.Get("svg").String(),
		Problems: linesOf(object.Get("problems")),
		Notes:    linesOf(object.Get("notes")),
	}
	if png := object.Get("png"); png != nil && !goja.IsNull(png) && !goja.IsUndefined(png) {
		bytes, err := bytesOf(png)
		if err != nil {
			return Answer{}, fmt.Errorf("the core's image: %w", err)
		}
		answer.PNG = bytes
	}
	return answer, nil
}

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
