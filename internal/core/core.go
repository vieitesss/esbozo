// Package core runs the bundled TypeScript core in goja, so that a Scene is
// parsed, measured and drawn by the same code the CLI and the editor run.
//
// No Scene rule lives on this side: Go passes a Scene's bytes and the flags one
// command takes, and reads back the SVG text, the PNG bytes or the lines `ez`
// prints. Every command has its own entry point, its own options and its own
// answer, so no command hands another one's flags over.
package core

import (
	"fmt"

	"github.com/dop251/goja"
)

// Result is what a command answered about a Scene: whether it ran, the code `ez`
// exits with, and the lines it prints.
type Result struct {
	// OK is whether the command succeeded; when it is false, ExitCode says why.
	OK bool
	// ExitCode is the code `ez` exits with, as `EXIT` in the TS CLI defines it.
	ExitCode int
	// Problems are the lines `ez` prints on stderr when it refuses.
	Problems []string
	// Notes are lines it prints without failing, such as a remote font warning.
	Notes []string
}

// Rendered is `ez render`'s answer: the SVG the Scene draws to.
type Rendered struct {
	Result
	// SVG is the rendering `render` writes.
	SVG string
}

// Image is `ez png`'s answer: the image the Scene draws to, in one theme.
type Image struct {
	Result
	// PNG is the image `png` drew.
	PNG []byte
}

// RenderOptions are `ez render`'s flags; an empty field is a flag that was not
// given.
type RenderOptions struct {
	// FontPath is `--font`: the font to measure and draw with.
	FontPath string
}

// CheckOptions are `ez check`'s flags; an empty field is a flag that was not
// given.
type CheckOptions struct {
	// FontPath is `--font`: the font to measure with.
	FontPath string
	// CSSPath is `--css`: the stylesheet the palette and the font come from.
	CSSPath string
}

// PNGOptions are `ez png`'s flags; an empty field is a flag that was not given.
type PNGOptions struct {
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

// Render answers `ez render` over a Scene's bytes.
func Render(source []byte, options RenderOptions) (Rendered, error) {
	answer, err := run("render", source, map[string]string{"fontPath": options.FontPath})
	if err != nil {
		return Rendered{}, err
	}
	return Rendered{Result: resultOf(answer), SVG: answer.Get("svg").String()}, nil
}

// Check answers `ez check` over a Scene's bytes: the lines its Labels overflow
// with.
func Check(source []byte, options CheckOptions) (Result, error) {
	answer, err := run("check", source, map[string]string{
		"fontPath": options.FontPath,
		"cssPath":  options.CSSPath,
	})
	if err != nil {
		return Result{}, err
	}
	return resultOf(answer), nil
}

// PNG answers `ez png` over a Scene's bytes: the image the Scene draws to.
func PNG(source []byte, options PNGOptions) (Image, error) {
	answer, err := run("png", source, map[string]string{
		"fontPath": options.FontPath,
		"cssPath":  options.CSSPath,
		"theme":    options.Theme,
		"ink":      options.Ink,
		"paper":    options.Paper,
		"muted":    options.Muted,
	})
	if err != nil {
		return Image{}, err
	}
	image := Image{Result: resultOf(answer)}
	if png := answer.Get("png"); png != nil && !goja.IsNull(png) && !goja.IsUndefined(png) {
		bytes, err := bytesOf(png)
		if err != nil {
			return Image{}, fmt.Errorf("the core's image: %w", err)
		}
		image.PNG = bytes
	}
	return image, nil
}

// run answers one command: `begin` starts `kind` over the Scene and the flags
// `flags` names, and `answer` reads what it settled on. Only the flags a command
// takes are in its request, so no command reads a field another one named.
func run(kind string, source []byte, flags map[string]string) (*goja.Object, error) {
	vm, err := newRuntime()
	if err != nil {
		return nil, err
	}

	request := vm.NewObject()
	if err := request.Set("source", vm.NewArrayBuffer(source)); err != nil {
		return nil, err
	}
	for name, value := range flags {
		if err := request.Set(name, optional(value)); err != nil {
			return nil, err
		}
	}

	// Two calls, not one: goja runs the queue of promises when the call that
	// awaited them ends, so `begin` settles the answer and `answer` reads it.
	begin, err := callableOf(vm, "begin")
	if err != nil {
		return nil, err
	}
	if _, err := begin(goja.Undefined(), request, vm.ToValue(kind)); err != nil {
		return nil, err
	}
	answer, err := callableOf(vm, "answer")
	if err != nil {
		return nil, err
	}
	value, err := answer(goja.Undefined())
	if err != nil {
		return nil, err
	}
	object, ok := value.(*goja.Object)
	if !ok {
		return nil, fmt.Errorf("the core answered with %s, not an object", value.ExportType())
	}
	return object, nil
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
func optional(value string) interface{} {
	if value == "" {
		return nil
	}
	return value
}

// resultOf reads the fields every command answers with.
func resultOf(answer *goja.Object) Result {
	return Result{
		OK:       answer.Get("ok").ToBoolean(),
		ExitCode: int(answer.Get("exitCode").ToInteger()),
		Problems: linesOf(answer.Get("problems")),
		Notes:    linesOf(answer.Get("notes")),
	}
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
