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

// Edited is `ez anchor` and `ez snap`'s answer: the Scene they would save, and
// the lines they print once they have.
type Edited struct {
	Result
	// Scene is the serialised Scene to write over the file the command read.
	Scene string
	// Lines are the lines the command prints after saving it.
	Lines []string
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

// AnchorOptions are the words `ez anchor` was given: every Snapped end that
// carries no Anchor, or one end and the place to put its Anchor at.
type AnchorOptions struct {
	// All is `--all`: freeze every Snapped end that carries no Anchor.
	All bool
	// ElementID is the arrow or line the command names, and empty for `--all`.
	ElementID string
	// End is the `start|end` word, and Place the place word, as the command line
	// typed them: their meaning is the core's, not the host's.
	End   string
	Place string
}

// SnapOptions are the words `ez snap` was given: the end to attach, and the
// Element to attach it to or `off`.
type SnapOptions struct {
	// ElementID is the arrow or line the command names.
	ElementID string
	// End is the `start|end` word, and Target the Element to attach to or `off`,
	// as the command line typed them.
	End    string
	Target string
}

// Render answers `ez render` over a Scene's bytes.
func Render(source []byte, options RenderOptions) (Rendered, error) {
	var rendered Rendered
	err := run("render", source, map[string]interface{}{"fontPath": options.FontPath},
		func(answer *goja.Object) error {
			rendered = Rendered{Result: resultOf(answer), SVG: answer.Get("svg").String()}
			return nil
		})
	return rendered, err
}

// Check answers `ez check` over a Scene's bytes: the lines its Labels overflow
// with.
func Check(source []byte, options CheckOptions) (Result, error) {
	var result Result
	err := run("check", source, map[string]interface{}{
		"fontPath": options.FontPath,
		"cssPath":  options.CSSPath,
	}, func(answer *goja.Object) error {
		result = resultOf(answer)
		return nil
	})
	return result, err
}

// PNG answers `ez png` over a Scene's bytes: the image the Scene draws to.
func PNG(source []byte, options PNGOptions) (Image, error) {
	var image Image
	err := run("png", source, map[string]interface{}{
		"fontPath": options.FontPath,
		"cssPath":  options.CSSPath,
		"theme":    options.Theme,
		"ink":      options.Ink,
		"paper":    options.Paper,
		"muted":    options.Muted,
	}, func(answer *goja.Object) error {
		image = Image{Result: resultOf(answer)}
		png := answer.Get("png")
		if png == nil || goja.IsNull(png) || goja.IsUndefined(png) {
			return nil
		}
		bytes, err := bytesOf(png)
		if err != nil {
			return fmt.Errorf("the core's image: %w", err)
		}
		image.PNG = bytes
		return nil
	})
	return image, err
}

// Anchor answers `ez anchor` over a Scene's bytes: the Scene the command would
// save, and the lines it prints once it has. A nil source is a Scene the host
// could not read, and answers only whether the command's words stand.
func Anchor(source []byte, options AnchorOptions) (Edited, error) {
	var edited Edited
	err := run("anchor", source, map[string]interface{}{
		"all":       options.All,
		"elementId": options.ElementID,
		"end":       options.End,
		"place":     options.Place,
	}, func(answer *goja.Object) error {
		edited = editedOf(answer)
		return nil
	})
	return edited, err
}

// Snap answers `ez snap` over a Scene's bytes: the Scene the command would save,
// and the lines it prints once it has. A nil source is a Scene the host could not
// read, and answers only whether the command's words stand.
func Snap(source []byte, options SnapOptions) (Edited, error) {
	var edited Edited
	err := run("snap", source, map[string]interface{}{
		"elementId": options.ElementID,
		"end":       options.End,
		"target":    options.Target,
	}, func(answer *goja.Object) error {
		edited = editedOf(answer)
		return nil
	})
	return edited, err
}

// editedOf reads the Scene text and the lines an editing command answered with.
func editedOf(answer *goja.Object) Edited {
	return Edited{
		Result: resultOf(answer),
		Scene:  answer.Get("scene").String(),
		Lines:  linesOf(answer.Get("lines")),
	}
}

// run answers one command: `begin` starts `kind` over the Scene and the fields
// `fields` names, `answer` reads what it settled on, and `read` decodes that answer
// before `run` returns. Nothing the runtime made outlives the call, so a runtime
// the host keeps — behind a lock, once more than one command shares it — is only
// ever touched from inside here. Only the fields a command takes are in its
// request, so no command reads a field another one named.
func run(kind string, source []byte, fields map[string]interface{}, read func(*goja.Object) error) error {
	vm, err := newRuntime()
	if err != nil {
		return err
	}

	request := vm.NewObject()
	// No Scene at all is null, not an empty one: the command judges its words and
	// edits nothing.
	if source == nil {
		if err := request.Set("source", goja.Null()); err != nil {
			return err
		}
	} else if err := request.Set("source", vm.NewArrayBuffer(source)); err != nil {
		return err
	}
	for name, value := range fields {
		if err := request.Set(name, optional(value)); err != nil {
			return err
		}
	}

	// Two calls, not one: goja runs the queue of promises when the call that
	// awaited them ends, so `begin` settles the answer and `answer` reads it.
	begin, err := callableOf(vm, "begin")
	if err != nil {
		return err
	}
	if _, err := begin(goja.Undefined(), request, vm.ToValue(kind)); err != nil {
		return err
	}
	answer, err := callableOf(vm, "answer")
	if err != nil {
		return err
	}
	value, err := answer(goja.Undefined())
	if err != nil {
		return err
	}
	object, ok := value.(*goja.Object)
	if !ok {
		return fmt.Errorf("the core answered with %s, not an object", value.ExportType())
	}
	return read(object)
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

// optional turns an absent flag into the null the core tests for, and leaves a
// flag that is either given or not — `--all` — as it is.
func optional(value interface{}) interface{} {
	if text, isText := value.(string); isText && text == "" {
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
