// Package core runs the bundled TypeScript core in goja.
package core

import (
	"fmt"
	"reflect"
	"sync"

	"github.com/dop251/goja"
)

// The exit codes the core answers with; `describe` reports the same table.
const (
	ExitOK                 = 0
	ExitUsage              = 2
	ExitInvalidScene       = 3
	ExitWriteFailed        = 4
	ExitMissingThemeOrFont = 5
	ExitLabelOverflow      = 6
)

// Result is the common outcome of a core command.
type Result struct {
	OK       bool
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

// SceneListing is how a folder lists a file it holds: by its name alone, or by
// reading it as a Scene too.
type SceneListing string

const (
	SceneListingAlways  SceneListing = "always"
	SceneListingIfScene SceneListing = "if-scene"
	SceneListingNever   SceneListing = "never"
)

// SceneNames is what the core answers for a Scene's file name: the problem the
// name has, the names built from it, how a folder lists the file, and the size
// past which a listing does not read it.
type SceneNames struct {
	Result
	// Problem is why the name is no Scene name, or "" when it is one.
	Problem string
	// Stem is the name without its Scene extension.
	Stem string
	// SVG is the SVG drawn beside the Scene.
	SVG string
	// PNG is the image named for the theme asked for, or "" when none was.
	PNG string
	// Listed is how a folder lists the file.
	Listed SceneListing
	// MaxListedSceneBytes is the size past which a listing does not read a Scene.
	MaxListedSceneBytes int64
}

// RenderOptions configures Render.
type RenderOptions struct {
	FontPath string `key:"fontPath"`
}

// CheckOptions configures Check.
type CheckOptions struct {
	FontPath string `key:"fontPath"`
	CSSPath  string `key:"cssPath"`
}

// PNGOptions configures PNG.
type PNGOptions struct {
	FontPath string `key:"fontPath"`
	CSSPath  string `key:"cssPath"`
	// Theme is "light" or "dark".
	Theme string `key:"theme"`
	Ink   string `key:"ink"`
	Paper string `key:"paper"`
	Muted string `key:"muted"`
}

// AnchorOptions configures Anchor. When All is true, ElementID, End, and Place are ignored.
type AnchorOptions struct {
	ScenePath string `key:"scenePath"`
	All       bool   `key:"all"`
	ElementID string `key:"elementId"`
	End       string `key:"end"`
	Place     string `key:"place"`
}

// SnapOptions configures Snap; Target is an Element id or "off".
type SnapOptions struct {
	ScenePath string `key:"scenePath"`
	ElementID string `key:"elementId"`
	End       string `key:"end"`
	Target    string `key:"target"`
}

// keyTag names the request key an option field sends.
const keyTag = "key"

// fieldsOf maps a command's options to the request keys it sends. Every option
// field carries the tag that names its key, and an empty string arrives at the
// core as null. A field that names no key, or a key a second field claims, is a
// mistake in the struct rather than in a request, so it panics instead of
// sending the core a request the core would refuse.
func fieldsOf(options any) map[string]interface{} {
	value := reflect.ValueOf(options)
	name := value.Type().Name()
	fields := make(map[string]interface{}, value.NumField())
	for index := range value.NumField() {
		field := value.Type().Field(index)
		key, tagged := field.Tag.Lookup(keyTag)
		if !tagged {
			panic(fmt.Sprintf("%s.%s has no key tag", name, field.Name))
		}
		if key == "" {
			panic(fmt.Sprintf("%s.%s has an empty key tag", name, field.Name))
		}
		if _, taken := fields[key]; taken {
			panic(fmt.Sprintf("%s.%s repeats the key %s", name, field.Name, key))
		}
		fields[key] = value.Field(index).Interface()
	}
	return fields
}

func Render(source []byte, options RenderOptions) (Rendered, error) {
	var rendered Rendered
	err := runOnce("render", source, fieldsOf(options),
		func(answer *goja.Object) error {
			rendered = Rendered{Result: resultOf(answer), SVG: answer.Get("svg").String()}
			return nil
		})
	return rendered, err
}

func Check(source []byte, options CheckOptions) (Result, error) {
	var result Result
	err := runOnce("check", source, fieldsOf(options), func(answer *goja.Object) error {
		result = resultOf(answer)
		return nil
	})
	return result, err
}

func PNG(source []byte, options PNGOptions) (Image, error) {
	var image Image
	err := runOnce("png", source, fieldsOf(options), func(answer *goja.Object) error {
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

// Anchor runs ez anchor. The core reads the Scene at options.ScenePath, and
// answers whether it could, so Go holds no rule about the file.
func Anchor(options AnchorOptions) (Edited, error) {
	var edited Edited
	err := runOnce("anchor", nil, fieldsOf(options), func(answer *goja.Object) error {
		edited = editedOf(answer)
		return nil
	})
	return edited, err
}

// Snap runs ez snap. The core reads the Scene at options.ScenePath, and answers
// whether it could, so Go holds no rule about the file.
func Snap(options SnapOptions) (Edited, error) {
	var edited Edited
	err := runOnce("snap", nil, fieldsOf(options), func(answer *goja.Object) error {
		edited = editedOf(answer)
		return nil
	})
	return edited, err
}

// namesRequest is the request `names` reads: the Scene's file name, and the
// theme its PNG is named for.
type namesRequest struct {
	FileName string `key:"fileName"`
	Theme    string `key:"theme"`
}

// Names answers a Scene's file rules without a Session of its own.
func Names(fileName, theme string) (SceneNames, error) {
	session, err := Open()
	if err != nil {
		return SceneNames{}, err
	}
	return session.Names(fileName, theme)
}

// Names answers a Scene's file rules. The theme names the PNG too; an empty
// theme names none.
func (session *Session) Names(fileName, theme string) (SceneNames, error) {
	var names SceneNames
	fields := fieldsOf(namesRequest{FileName: fileName, Theme: theme})
	err := session.call("names", func(vm *goja.Runtime) (*goja.Object, error) {
		return fieldsRequestOf(vm, fields)
	}, func(answer *goja.Object) error {
		names = sceneNamesOf(answer)
		return nil
	})
	return names, err
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

// runOnce runs one command in a runtime of its own. A nil source is a command
// that reads its Scene from a path in its options instead.
func runOnce(kind string, source []byte, fields map[string]interface{}, read func(*goja.Object) error) error {
	session, err := Open()
	if err != nil {
		return err
	}
	return session.run(kind, source, fields, read)
}

// run sends one command over this Scene and these option fields.
func (session *Session) run(kind string, source []byte, fields map[string]interface{}, read func(*goja.Object) error) error {
	return session.call(kind, func(vm *goja.Runtime) (*goja.Object, error) {
		return requestOf(vm, source, fields)
	}, read)
}

// requestOf is the request a command reads: its Scene, when it takes one, then
// its option fields.
func requestOf(vm *goja.Runtime, source []byte, fields map[string]interface{}) (*goja.Object, error) {
	request, err := fieldsRequestOf(vm, fields)
	if err != nil {
		return nil, err
	}
	if source != nil {
		if err := request.Set("source", vm.NewArrayBuffer(source)); err != nil {
			return nil, err
		}
	}
	return request, nil
}

// fieldsRequestOf is the request of a command that reads no Scene: its option
// fields alone.
func fieldsRequestOf(vm *goja.Runtime, fields map[string]interface{}) (*goja.Object, error) {
	request := vm.NewObject()
	for name, value := range fields {
		if err := request.Set(name, value); err != nil {
			return nil, err
		}
	}
	return request, nil
}

// call begins one command over the request build makes, and hands its answer to read.
func (session *Session) call(kind string, build func(*goja.Runtime) (*goja.Object, error), read func(*goja.Object) error) error {
	session.mu.Lock()
	defer session.mu.Unlock()
	vm := session.vm

	request, err := build(vm)
	if err != nil {
		return err
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

func resultOf(answer *goja.Object) Result {
	return Result{
		OK:       answer.Get("ok").ToBoolean(),
		ExitCode: int(answer.Get("exitCode").ToInteger()),
		Problems: linesOf(answer.Get("problems")),
		Notes:    linesOf(answer.Get("notes")),
	}
}

func sceneNamesOf(answer *goja.Object) SceneNames {
	return SceneNames{
		Result:              resultOf(answer),
		Problem:             textOf(answer.Get("problem")),
		Stem:                answer.Get("stem").String(),
		SVG:                 answer.Get("svg").String(),
		PNG:                 textOf(answer.Get("png")),
		Listed:              SceneListing(answer.Get("listed").String()),
		MaxListedSceneBytes: answer.Get("maxListedSceneBytes").ToInteger(),
	}
}

// textOf is a string answer the core may answer null for.
func textOf(value goja.Value) string {
	if value == nil || goja.IsNull(value) || goja.IsUndefined(value) {
		return ""
	}
	return value.String()
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
