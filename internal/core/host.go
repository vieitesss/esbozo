package core

import (
	"crypto/sha256"
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

// *goja.Program is independent of any runtime and safe for concurrent reuse.
var compiled struct {
	once    sync.Once
	program *goja.Program
	err     error
}

func program() (*goja.Program, error) {
	compiled.once.Do(func() {
		compiled.program, compiled.err = goja.Compile("core.js", string(esbozo.CoreBundle), false)
		if compiled.err != nil {
			compiled.err = fmt.Errorf("the core bundle does not compile: %w", compiled.err)
		}
	})
	return compiled.program, compiled.err
}

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

	if err := host.Set("sha256", func(call goja.FunctionCall) goja.Value {
		bytes, err := bytesOf(call.Argument(0))
		if err != nil {
			panic(vm.NewGoError(err))
		}
		digest := sha256.Sum256(bytes)
		return vm.ToValue(vm.NewArrayBuffer(digest[:]))
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

	if err := host.Set("cwd", func(call goja.FunctionCall) goja.Value {
		folder, err := os.Getwd()
		if err != nil {
			panic(vm.NewGoError(err))
		}
		return vm.ToValue(folder)
	}); err != nil {
		return err
	}

	if err := host.Set("bundledFont", func(call goja.FunctionCall) goja.Value {
		return vm.ToValue(vm.NewArrayBuffer(esbozo.Kalam))
	}); err != nil {
		return err
	}

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

// decodeUtf8 matches Node's Buffer.toString('utf8') using Unicode maximal-subpart
// U+FFFD replacement; Go's utf8.DecodeRune replaces one byte at a time.
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

// NodeMessage formats err in Node's fs error wording (e.g. "ENOENT: ..., open 'path'").
// When reading is true, EISDIR formats as a read error.
func NodeMessage(err error, path string, reading bool) string {
	if reading && errors.Is(err, syscall.EISDIR) {
		return "EISDIR: illegal operation on a directory, read"
	}
	return nodeMessage(err, path, "open")
}

// NodeMkdirMessage formats an os.MkdirAll error in Node's fs.mkdir wording.
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
	// Node probes dir before climbing, whereas os.MkdirAll reports the failing
	// ancestor; stat dir to match Node's error code and path.
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
