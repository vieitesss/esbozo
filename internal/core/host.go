package core

import (
	"errors"
	"fmt"
	"io/fs"
	"os"
	"strings"
	"sync"
	"syscall"
	"unicode/utf8"

	"github.com/dop251/goja"

	"esbozo"
	"esbozo/internal/resvg"
)

// compiled is the core bundle, compiled once for the process: a `*goja.Program`
// is safe to run in many runtimes, so every command need not compile 333 kB of
// it again.
var compiled struct {
	once    sync.Once
	program *goja.Program
	err     error
}

// program is the core bundle as a program, compiled on first use.
func program() (*goja.Program, error) {
	compiled.once.Do(func() {
		compiled.program, compiled.err = goja.Compile("core.js", string(esbozo.CoreBundle), false)
		if compiled.err != nil {
			compiled.err = fmt.Errorf("the core bundle does not compile: %w", compiled.err)
		}
	})
	return compiled.program, compiled.err
}

// newRuntime is one fresh goja runtime with the core bundle evaluated in it.
func newRuntime() (*goja.Runtime, error) {
	vm := goja.New()
	if err := installHost(vm); err != nil {
		return nil, err
	}
	source, err := program()
	if err != nil {
		return nil, err
	}
	if _, err := vm.RunProgram(source); err != nil {
		return nil, fmt.Errorf("the core bundle does not run: %w", err)
	}
	return vm, nil
}

// installHost is the whole of what the core is allowed to ask its host for.
//
// `src/font.ts` reads the font and the stylesheet through `node:fs/promises`, and
// `src/scene.ts` and `src/sha256.ts` hash with `TextEncoder`; the bundle reaches
// those through `globalThis.__ezHost` and a `TextEncoder` the entry defines, so
// no Node API ever ships inside it. `bundledFont` and `bundledFontMetrics` are
// the same seam for what the binary already carries, and `rasterise` is resvg's
// `render().asPng()`, which `scripts/core-host/resvg-wasm.mjs` calls. A failed
// read or a refused SVG throws, because the core's own error messages are built
// from the exception's `message`.
func installHost(vm *goja.Runtime) error {
	host := vm.NewObject()

	if err := host.Set("readText", func(call goja.FunctionCall) goja.Value {
		path := call.Argument(0).String()
		bytes, err := os.ReadFile(path)
		if err != nil {
			panic(vm.NewGoError(errors.New(NodeMessage(err, path, true))))
		}
		return vm.ToValue(string(bytes))
	}); err != nil {
		return err
	}

	if err := host.Set("readBytes", func(call goja.FunctionCall) goja.Value {
		path := call.Argument(0).String()
		bytes, err := os.ReadFile(path)
		if err != nil {
			panic(vm.NewGoError(errors.New(NodeMessage(err, path, true))))
		}
		return vm.ToValue(vm.NewArrayBuffer(bytes))
	}); err != nil {
		return err
	}

	if err := host.Set("encodeUtf8", func(call goja.FunctionCall) goja.Value {
		return vm.ToValue(vm.NewArrayBuffer([]byte(call.Argument(0).String())))
	}); err != nil {
		return err
	}

	if err := host.Set("decodeUtf8", func(call goja.FunctionCall) goja.Value {
		bytes, err := bytesOf(call.Argument(0))
		if err != nil {
			panic(vm.NewGoError(err))
		}
		return vm.ToValue(decodeUtf8(bytes))
	}); err != nil {
		return err
	}

	// A stylesheet's `@font-face` url is resolved beside the stylesheet, which the
	// command line may have named relatively: only the host knows where that is.
	if err := host.Set("cwd", func(call goja.FunctionCall) goja.Value {
		folder, err := os.Getwd()
		if err != nil {
			panic(vm.NewGoError(err))
		}
		return vm.ToValue(folder)
	}); err != nil {
		return err
	}

	// NewArrayBuffer wraps the slice, so the core reads the binary's own bytes.
	if err := host.Set("bundledFont", func(call goja.FunctionCall) goja.Value {
		return vm.ToValue(vm.NewArrayBuffer(esbozo.Kalam))
	}); err != nil {
		return err
	}

	// What `scripts/build-core.mjs` measured, so no cold start parses the font.
	if err := host.Set("bundledFontMetrics", func(call goja.FunctionCall) goja.Value {
		return vm.ToValue(string(esbozo.FontMetrics))
	}); err != nil {
		return err
	}

	if err := host.Set("rasterise", func(call goja.FunctionCall) goja.Value {
		png, err := resvg.Rasterise(call.Argument(0).String(), call.Argument(1).String())
		if err != nil {
			panic(vm.NewGoError(err))
		}
		return vm.ToValue(vm.NewArrayBuffer(png))
	}); err != nil {
		return err
	}

	return vm.Set("__ezHost", host)
}

// decodeUtf8 is `Buffer.toString('utf8')`: valid UTF-8 passes through, and a
// sequence that encodes no character becomes U+FFFD — one for each maximal subpart
// of it, so a truncated character counts once and a byte no sequence starts with
// counts once. Go's own `string(bytes)` replaces one per byte, which would turn a
// character cut off across a chunk boundary into two, and `anchor` and `snap` write
// that text back over the Scene.
func decodeUtf8(source []byte) string {
	if utf8.Valid(source) {
		return string(source)
	}
	var text strings.Builder
	text.Grow(len(source))
	for index := 0; index < len(source); {
		character, size := utf8.DecodeRune(source[index:])
		if character != utf8.RuneError || size > 1 {
			text.Write(source[index : index+size])
			index += size
			continue
		}
		text.WriteRune(utf8.RuneError)
		index += maximalSubpart(source[index:])
	}
	return text.String()
}

// maximalSubpart is how many bytes of a sequence that encodes no character belong to
// one replacement: the lead byte and the continuation bytes it still wanted, as far
// as the input has them and as far as each stays in the range that byte may take —
// which is what makes a surrogate (`ED A0`) two replacements and not one.
func maximalSubpart(source []byte) int {
	lead := source[0]
	width, lowest, highest := 0, byte(0x80), byte(0xBF)
	switch {
	case lead >= 0xC2 && lead <= 0xDF:
		width = 2
	case lead >= 0xE0 && lead <= 0xEF:
		width = 3
		if lead == 0xE0 {
			lowest = 0xA0
		}
		if lead == 0xED {
			highest = 0x9F
		}
	case lead >= 0xF0 && lead <= 0xF4:
		width = 4
		if lead == 0xF0 {
			lowest = 0x90
		}
		if lead == 0xF4 {
			highest = 0x8F
		}
	default:
		// A continuation byte no sequence began, or a byte no sequence begins with.
		return 1
	}
	size := 1
	for ; size < width && size < len(source); size++ {
		if source[size] < lowest || source[size] > highest {
			break
		}
		lowest, highest = 0x80, 0xBF
	}
	return size
}

func bytesOf(value goja.Value) ([]byte, error) {
	switch bytes := value.Export().(type) {
	case goja.ArrayBuffer:
		return bytes.Bytes(), nil
	case []byte:
		return bytes, nil
	}
	return nil, fmt.Errorf("expected bytes, got %s", value.ExportType())
}

// NodeMessage is a file error as Node words it, because every message `ez` prints
// about a file is built around Node's: `cannot read font x: ENOENT: no such file
// or directory, open 'x'`. Go already carries the code and the reason; what Node
// adds is the call that made it, which is `open` for a path it could not open and
// `read` for the read of a directory that failed.
func NodeMessage(err error, path string, reading bool) string {
	if reading && errors.Is(err, syscall.EISDIR) {
		return "EISDIR: illegal operation on a directory, read"
	}
	return nodeMessage(err, path, "open")
}

// NodeMkdirMessage is what Node says about a folder it could not make: the wording
// above with `mkdir` where `open` goes. Node makes a folder by probing the path it
// was given before it climbs, so what it names is what it found — a file where the
// folder should be is `EEXIST`, a file above it is `ENOTDIR` naming the folder, and
// a dangling link is the `ENOENT` the kernel gives for a path that leads nowhere.
func NodeMkdirMessage(err error, dir string) string {
	var pathErr *fs.PathError
	if !errors.As(err, &pathErr) {
		return err.Error()
	}
	taken := errors.Is(pathErr.Err, fs.ErrExist) ||
		(errors.Is(pathErr.Err, syscall.ENOTDIR) && pathErr.Path == dir)
	if !taken {
		if errors.Is(pathErr.Err, syscall.ENOTDIR) {
			return nodeMessage(pathErr.Err, dir, "mkdir")
		}
		return nodeMessage(pathErr.Err, pathErr.Path, "mkdir")
	}
	// The name is taken. What Node reports is what it found there: a folder it
	// cannot walk through, a file it cannot make a folder of, or nothing at all —
	// nothing at all being the folder itself when `MkdirAll` reached it, and the
	// folder it was climbing through when the name it could not take was above.
	info, statErr := os.Stat(dir)
	switch {
	case statErr != nil && !errors.Is(statErr, fs.ErrNotExist):
		return nodeMessage(statErr, dir, "mkdir")
	case info != nil:
		return nodeMessage(syscall.EEXIST, dir, "mkdir")
	case pathErr.Path == dir:
		return nodeMessage(statErr, dir, "mkdir")
	}
	return nodeMessage(syscall.ENOTDIR, pathErr.Path, "mkdir")
}

// The wording below is Node's for one file error, made by `call`, so every file
// error comes from one place: `CODE: reason, call 'path'`.
func nodeMessage(err error, path, call string) string {
	switch {
	case errors.Is(err, fs.ErrNotExist):
		return fmt.Sprintf("ENOENT: no such file or directory, %s '%s'", call, path)
	case errors.Is(err, fs.ErrPermission):
		return fmt.Sprintf("EACCES: permission denied, %s '%s'", call, path)
	case errors.Is(err, syscall.EEXIST):
		return fmt.Sprintf("EEXIST: file already exists, %s '%s'", call, path)
	case errors.Is(err, syscall.ELOOP):
		return fmt.Sprintf("ELOOP: too many symbolic links encountered, %s '%s'", call, path)
	case errors.Is(err, syscall.EISDIR):
		return fmt.Sprintf("EISDIR: illegal operation on a directory, %s '%s'", call, path)
	case errors.Is(err, syscall.ENOTDIR):
		return fmt.Sprintf("ENOTDIR: not a directory, %s '%s'", call, path)
	}
	return err.Error()
}
