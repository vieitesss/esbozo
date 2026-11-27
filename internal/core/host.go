package core

import (
	"errors"
	"fmt"
	"io/fs"
	"os"

	"github.com/dop251/goja"

	"esbozo"
)

// newRuntime is one fresh goja runtime with the core bundle evaluated in it.
//
// ADR 0003 has every `ez` call start a fresh runtime, so nothing carries over
// from one command to the next; `ez serve` will keep one behind a lock.
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

// installHost is the whole of what the core is allowed to ask its host for: read
// a file, turn text into bytes and back, say where the process runs, hand over
// the bundled font, and hand over what measuring it yields.
//
// `src/font.ts` reads the font and the stylesheet through `node:fs/promises`, and
// `src/scene.ts` and `src/sha256.ts` hash with `TextEncoder`; the bundle reaches
// those through `globalThis.__ezHost` and a `TextEncoder` the entry defines, so
// no Node API ever ships inside it. `bundledFont` is the same seam for the `.ttf`
// `src/font.ts` imports: the binary embeds Kalam anyway, so the bundle asks for
// those bytes rather than carrying a base64 copy. `bundledFontMetrics` is that
// seam one step further — the parse of those bytes, taken at build time — and is
// `null` when the build could not prove one. A failed read throws, because the
// core's own error messages are built from the exception's `message`.
func installHost(vm *goja.Runtime) error {
	host := vm.NewObject()

	if err := host.Set("readText", func(call goja.FunctionCall) goja.Value {
		path := call.Argument(0).String()
		bytes, err := os.ReadFile(path)
		if err != nil {
			panic(vm.NewGoError(errors.New(hostMessage(err, path))))
		}
		return vm.ToValue(string(bytes))
	}); err != nil {
		return err
	}

	if err := host.Set("readBytes", func(call goja.FunctionCall) goja.Value {
		path := call.Argument(0).String()
		bytes, err := os.ReadFile(path)
		if err != nil {
			panic(vm.NewGoError(errors.New(hostMessage(err, path))))
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

	// The folder this process runs in: a stylesheet's `@font-face` url is
	// resolved beside the stylesheet, which the command line may have named
	// relatively, and only the host knows where that is.
	if err := host.Set("cwd", func(call goja.FunctionCall) goja.Value {
		folder, err := os.Getwd()
		if err != nil {
			panic(vm.NewGoError(err))
		}
		return vm.ToValue(folder)
	}); err != nil {
		return err
	}

	// The bundled font, handed over rather than copied: NewArrayBuffer wraps the
	// slice, so the core reads the binary's own bytes.
	if err := host.Set("bundledFont", func(call goja.FunctionCall) goja.Value {
		return vm.ToValue(vm.NewArrayBuffer(esbozo.Kalam))
	}); err != nil {
		return err
	}

	// The measurements of those bytes, as `scripts/build-core.mjs` took them: the
	// core reads the table instead of parsing 427 KB of font on every cold start.
	if err := host.Set("bundledFontMetrics", func(call goja.FunctionCall) goja.Value {
		return vm.ToValue(string(esbozo.FontMetrics))
	}); err != nil {
		return err
	}

	return vm.Set("__ezHost", host)
}

// bytesOf reads an ArrayBuffer or a byte slice out of a JS value.
func bytesOf(value goja.Value) ([]byte, error) {
	switch bytes := value.Export().(type) {
	case goja.ArrayBuffer:
		return bytes.Bytes(), nil
	case []byte:
		return bytes, nil
	}
	return nil, fmt.Errorf("expected bytes, got %s", value.ExportType())
}

// hostMessage is a read error as Node words it, because the core's messages are
// built around Node's: `cannot read font x: ENOENT: no such file or directory,
// open 'x'`. Anything else keeps Go's own wording.
func hostMessage(err error, path string) string {
	if errors.Is(err, fs.ErrNotExist) {
		return fmt.Sprintf("ENOENT: no such file or directory, open '%s'", path)
	}
	if errors.Is(err, fs.ErrPermission) {
		return fmt.Sprintf("EACCES: permission denied, open '%s'", path)
	}
	return err.Error()
}
