package core

import (
	"errors"
	"fmt"
	"io/fs"
	"os"
	"syscall"

	"github.com/dop251/goja"

	"esbozo"
)

// newRuntime is one fresh goja runtime with the core bundle evaluated in it.
func newRuntime() (*goja.Runtime, error) {
	vm := goja.New()
	if err := installHost(vm); err != nil {
		return nil, err
	}
	program, err := goja.Compile("core.js", string(esbozo.CoreBundle), false)
	if err != nil {
		return nil, fmt.Errorf("the core bundle does not compile: %w", err)
	}
	if _, err := vm.RunProgram(program); err != nil {
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
// the same seam for what the binary already carries. A failed read throws,
// because the core's own error messages are built from the exception's `message`.
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
		return vm.ToValue(string(bytes))
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

	return vm.Set("__ezHost", host)
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

// NodeMessage is a file error as Node words it, because every message `ez`
// prints about a file is built around Node's: `cannot read font x: ENOENT: no
// such file or directory, open 'x'`. Go already carries the code and the reason;
// what Node adds is the call that made it, which is `open` for a path it could
// not open and `read` for the read of a directory that failed.
func NodeMessage(err error, path string, reading bool) string {
	switch {
	case errors.Is(err, fs.ErrNotExist):
		return fmt.Sprintf("ENOENT: no such file or directory, open '%s'", path)
	case errors.Is(err, fs.ErrPermission):
		return fmt.Sprintf("EACCES: permission denied, open '%s'", path)
	case errors.Is(err, syscall.EISDIR) && reading:
		return "EISDIR: illegal operation on a directory, read"
	case errors.Is(err, syscall.EISDIR):
		return fmt.Sprintf("EISDIR: illegal operation on a directory, open '%s'", path)
	case errors.Is(err, syscall.ENOTDIR):
		return fmt.Sprintf("ENOTDIR: not a directory, open '%s'", path)
	}
	return err.Error()
}
