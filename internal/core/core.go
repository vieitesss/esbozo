// Package core runs the bundled TypeScript core in goja.
package core

import (
	"fmt"
	"sync"

	"github.com/dop251/goja"
)

// Result is the common outcome of a core command.
type Result struct {
	OK bool
	// ExitCode matches EXIT in src/exit.ts.
	ExitCode int
	// Problems are stderr lines printed on refusal.
	Problems []string
	// Notes are non-fatal warning lines.
	Notes []string
}

type Rendered struct {
	Result
	SVG string
}

type Image struct {
	Result
	PNG []byte
}

// Edited holds the serialised Scene to save and the stdout lines to print after saving.
type Edited struct {
	Result
	Scene string
	Lines []string
}

// RenderOptions configures Render; empty fields are omitted.
type RenderOptions struct {
	FontPath string
}

// CheckOptions configures Check; empty fields are omitted.
type CheckOptions struct {
	FontPath string
	CSSPath  string
}

// PNGOptions configures PNG; empty fields are omitted.
type PNGOptions struct {
	FontPath string
	CSSPath  string
	// Theme is "light" or "dark".
	Theme string
	Ink   string
	Paper string
	Muted string
}

// AnchorOptions configures Anchor. When All is true, ElementID, End, and Place are ignored.
type AnchorOptions struct {
	All       bool
	ElementID string
	End       string
	Place     string
}

// SnapOptions configures Snap; Target is an Element id or "off".
type SnapOptions struct {
	ElementID string
	End       string
	Target    string
}

func Render(source []byte, options RenderOptions) (Rendered, error) {
	var rendered Rendered
	err := runOnce("render", source, map[string]interface{}{"fontPath": options.FontPath},
		func(answer *goja.Object) error {
			rendered = Rendered{Result: resultOf(answer), SVG: answer.Get("svg").String()}
			return nil
		})
	return rendered, err
}

func Check(source []byte, options CheckOptions) (Result, error) {
	var result Result
	err := runOnce("check", source, map[string]interface{}{
		"fontPath": options.FontPath,
		"cssPath":  options.CSSPath,
	}, func(answer *goja.Object) error {
		result = resultOf(answer)
		return nil
	})
	return result, err
}

func PNG(source []byte, options PNGOptions) (Image, error) {
	var image Image
	err := runOnce("png", source, map[string]interface{}{
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

// Anchor runs ez anchor. A nil source validates options without editing a Scene.
func Anchor(source []byte, options AnchorOptions) (Edited, error) {
	var edited Edited
	err := runOnce("anchor", source, map[string]interface{}{
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

// Snap runs ez snap. A nil source validates options without editing a Scene.
func Snap(source []byte, options SnapOptions) (Edited, error) {
	var edited Edited
	err := runOnce("snap", source, map[string]interface{}{
		"elementId": options.ElementID,
		"end":       options.End,
		"target":    options.Target,
	}, func(answer *goja.Object) error {
		edited = editedOf(answer)
		return nil
	})
	return edited, err
}

func editedOf(answer *goja.Object) Edited {
	return Edited{
		Result: resultOf(answer),
		Scene:  answer.Get("scene").String(),
		Lines:  linesOf(answer.Get("lines")),
	}
}

// Session holds a reusable goja runtime serialised for concurrent use.
type Session struct {
	mu sync.Mutex
	vm *goja.Runtime
}

func Open() (*Session, error) {
	vm, err := newRuntime()
	if err != nil {
		return nil, err
	}
	return &Session{vm: vm}, nil
}

// Parse validates a Scene without measuring fonts or running Layout.
func (session *Session) Parse(source []byte) (Result, error) {
	var result Result
	err := session.run("parse", source, nil, func(answer *goja.Object) error {
		result = resultOf(answer)
		return nil
	})
	return result, err
}

func runOnce(kind string, source []byte, fields map[string]interface{}, read func(*goja.Object) error) error {
	session, err := Open()
	if err != nil {
		return err
	}
	return session.run(kind, source, fields, read)
}

func (session *Session) run(kind string, source []byte, fields map[string]interface{}, read func(*goja.Object) error) error {
	session.mu.Lock()
	defer session.mu.Unlock()
	vm := session.vm

	request := vm.NewObject()
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

func optional(value interface{}) interface{} {
	if text, isText := value.(string); isText && text == "" {
		return nil
	}
	return value
}

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
