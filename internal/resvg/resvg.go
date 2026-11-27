// Package resvg rasterises an SVG with the same resvg build the TypeScript CLI
// runs.
//
// `src/png.ts` owns everything that has to happen before resvg sees the SVG: the
// palette is resolved and the words are turned into outlines, so the SVG that
// arrives here has no text left in it. This side takes one SVG string and the
// module's options JSON, which is the whole of what `@resvg/resvg-wasm` accepts,
// and answers the PNG bytes `render().asPng()` would have handed back in Node.
//
// The module is `node_modules/@resvg/resvg-wasm/index_bg.wasm`, carried in the
// binary as `esbozo.ResvgModule` and run in wazero. What this package adds is the
// wasm-bindgen ABI around it: the imports resvg reaches on this path, each acting
// on a small heap of the values it touches.
package resvg

import (
	"context"
	"encoding/binary"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"github.com/tetratelabs/wazero"
	"github.com/tetratelabs/wazero/api"

	"esbozo"
)

// Rasterise draws svg — already free of text, as `src/png.ts` leaves it — and
// returns PNG bytes. options is resvg's options JSON, exactly as
// `@resvg/resvg-wasm` marshals what `src/png.ts` passes.
//
// The module is compiled and instantiated once per process and reused, which is
// what the Node side does with its single `initWasm` call; a failed start is
// remembered too, because it cannot become a success later.
func Rasterise(svg, options string) ([]byte, error) {
	one, err := shared()
	if err != nil {
		return nil, err
	}
	return one.rasterise(svg, options)
}

var (
	sharedOnce   sync.Once
	sharedModule *rasteriser
	sharedErr    error
)

// shared is the one rasteriser, made on the first PNG and never before: nothing
// that does not draw a PNG pays for compiling the module.
func shared() (*rasteriser, error) {
	sharedOnce.Do(func() { sharedModule, sharedErr = newRasteriser(cacheDir()) })
	return sharedModule, sharedErr
}

// cacheDir is where wazero keeps resvg's module compiled between runs. Compiling
// it costs ~2.6 s and reading a warm entry ~53 ms, so `ez png` pays for the
// compile once rather than once per PNG. Empty when the platform names no cache
// directory, which costs that time and nothing else.
func cacheDir() string {
	base, err := os.UserCacheDir()
	if err != nil {
		return ""
	}
	return filepath.Join(base, "esbozo", "wazero")
}

// rasteriser is the one module and the state of the call in flight. resvg keeps
// module-level state in the wasm (a global allocator, the shadow stack pointer),
// so calls are serialised on mu rather than run concurrently.
type rasteriser struct {
	ctx     context.Context
	runtime wazero.Runtime
	module  api.Module
	mu      sync.Mutex
	heap    *heap
}

// newRasteriser makes the one module, over the compilation cache in dir when
// there is one. A cache that does not work is worth exactly nothing: it buys
// seconds, and it must never cost the PNG.
func newRasteriser(dir string) (*rasteriser, error) {
	cache := compilationCache(dir)
	one, err := startWith(cache)
	if cache == nil || err == nil {
		return one, err
	}

	// An entry wazero cannot read or cannot replace — a crash left it truncated,
	// another writer left it nonsense — fails the compile outright, and would go on
	// failing every run until the user deleted it. Compiling again without the
	// cache costs seconds and draws.
	return startWith(nil)
}

// startWith makes a runtime over cache, if any, and starts the module in it.
func startWith(cache wazero.CompilationCache) (*rasteriser, error) {
	ctx := context.Background()
	one := &rasteriser{ctx: ctx}

	// NewRuntimeConfig picks wazero's compiler engine when the platform has one
	// and the interpreter when it does not, so this builds anywhere.
	config := wazero.NewRuntimeConfig()
	if cache != nil {
		config = config.WithCompilationCache(cache)
	}
	one.runtime = wazero.NewRuntimeWithConfig(ctx, config)
	if err := one.installWbg(); err != nil {
		_ = one.runtime.Close(ctx)
		return nil, err
	}
	module, err := one.runtime.Instantiate(ctx, esbozo.ResvgModule)
	if err != nil {
		_ = one.runtime.Close(ctx)
		return nil, fmt.Errorf("cannot start resvg's WebAssembly module: %w", err)
	}
	one.module = module
	return one, nil
}

// rasterise is the call sequence the wasm-bindgen glue runs for
// `new Resvg(svg, options).render().asPng()`, in the same order and with the
// same arguments.
func (one *rasteriser) rasterise(svg, options string) ([]byte, error) {
	one.mu.Lock()
	defer one.mu.Unlock()
	one.heap = newHeap()

	// The glue reserves 16 bytes of the module's shadow stack for the results of
	// one call. One reservation serves the whole sequence: the wasm frames grow
	// down from the pointer it returns.
	retptr, err := one.moveStackPointer(-16)
	if err != nil {
		return nil, err
	}
	defer func() { _, _ = one.moveStackPointer(16) }()

	svgHandle := one.heap.add(&object{kind: jsString, text: svg})

	optionsPtr, err := one.malloc(len(options))
	if err != nil {
		return nil, err
	}
	defer one.free(optionsPtr, len(options))
	if !one.memory().Write(optionsPtr, []byte(options)) {
		return nil, fmt.Errorf("resvg's memory cannot hold %d bytes of options", len(options))
	}

	// No custom font buffers: `src/png.ts` draws words as outlines, so resvg
	// never needs a font.
	if err := one.call("resvg_new", retptr, svgHandle, optionsPtr, uint32(len(options)), 0); err != nil {
		return nil, err
	}
	svgObject, err := one.result(retptr)
	if err != nil {
		return nil, err
	}
	defer one.call("__wbg_resvg_free", svgObject)

	if err := one.call("resvg_render", retptr, svgObject); err != nil {
		return nil, err
	}
	image, err := one.result(retptr)
	if err != nil {
		return nil, err
	}
	defer one.call("__wbg_renderedimage_free", image)

	if err := one.call("renderedimage_asPng", retptr, image); err != nil {
		return nil, err
	}
	pngHandle, err := one.result(retptr)
	if err != nil {
		return nil, err
	}
	object, ok := one.heap.take(pngHandle)
	if !ok {
		return nil, errors.New("resvg answered with a PNG handle the heap does not hold")
	}
	if object.kind != jsBytes {
		return nil, fmt.Errorf("resvg answered with a %s, not PNG bytes", object.kind)
	}
	return object.bytes, nil
}

// call runs one export with 32-bit arguments.
func (one *rasteriser) call(name string, params ...uint32) error {
	function := one.module.ExportedFunction(name)
	if function == nil {
		return fmt.Errorf("the resvg module exports no %s", name)
	}
	arguments := make([]uint64, len(params))
	for at, param := range params {
		arguments[at] = uint64(param)
	}
	if _, err := function.Call(one.ctx, arguments...); err != nil {
		return fmt.Errorf("resvg's %s: %w", name, withoutStackTrace(err))
	}
	return nil
}

// withoutStackTrace drops the wasm stack trace wazero appends to a trap: the
// frames are the module's, and the message is the one line saying why the PNG
// could not be drawn.
func withoutStackTrace(err error) error {
	message, _, _ := strings.Cut(err.Error(), "\nwasm stack trace:")
	return errors.New(message)
}

// result reads what one call left in the reserved stack area: the value, and the
// handle of the exception it threw instead, if any.
func (one *rasteriser) result(retptr uint32) (uint32, error) {
	buffer, ok := one.memory().Read(retptr, 12)
	if !ok {
		return 0, fmt.Errorf("resvg's result area at %d is past the end of its memory", retptr)
	}
	if binary.LittleEndian.Uint32(buffer[8:]) != 0 {
		handle := binary.LittleEndian.Uint32(buffer[4:])
		thrown, ok := one.heap.take(handle)
		if !ok {
			return 0, errors.New("resvg threw, and the heap holds nothing at that handle")
		}
		if thrown.kind == jsError {
			return 0, errors.New(thrown.text)
		}
		return 0, fmt.Errorf("resvg threw a %s", thrown.kind)
	}
	return binary.LittleEndian.Uint32(buffer), nil
}

func (one *rasteriser) moveStackPointer(delta int32) (uint32, error) {
	results, err := one.module.ExportedFunction("__wbindgen_add_to_stack_pointer").
		Call(one.ctx, uint64(uint32(delta)))
	if err != nil {
		return 0, fmt.Errorf("resvg's shadow stack: %w", err)
	}
	return uint32(results[0]), nil
}

func (one *rasteriser) malloc(size int) (uint32, error) {
	results, err := one.module.ExportedFunction("__wbindgen_malloc").Call(one.ctx, uint64(size), 1)
	if err != nil {
		return 0, fmt.Errorf("resvg's allocator: %w", err)
	}
	return uint32(results[0]), nil
}

func (one *rasteriser) free(pointer uint32, size int) {
	_ = one.call("__wbindgen_free", pointer, uint32(size), 1)
}

func (one *rasteriser) memory() api.Memory {
	return one.module.Memory()
}

// compilationCache is wazero's store of compiled code in dir, or nil when dir
// cannot hold one. Every failure here is swallowed on purpose: a cache only ever
// buys time, and the PNG has to be drawn anyway. A directory that exists but
// refuses a write is the case worth naming, because wazero fails the compile
// outright when it cannot save the result, so it has to be given up beforehand.
func compilationCache(dir string) wazero.CompilationCache {
	if dir == "" || ensureWritable(dir) != nil {
		return nil
	}
	cache, err := wazero.NewCompilationCacheWithDir(dir)
	if err != nil {
		return nil
	}
	return cache
}

// ensureWritable makes dir and proves a file can be written in it: only a real
// write tells a read-only directory from a writable one.
func ensureWritable(dir string) error {
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	probe, err := os.CreateTemp(dir, "probe")
	if err != nil {
		return err
	}
	defer func() { _ = os.Remove(probe.Name()) }()
	return probe.Close()
}

// kind is what a heap object is, as far as the imports need to tell them apart.
type kind int

const (
	jsString kind = iota
	jsError
	jsMemory
	jsArrayBuffer
	jsView
	jsBytes
)

func (k kind) String() string {
	switch k {
	case jsString:
		return "string"
	case jsError:
		return "error"
	case jsMemory:
		return "WebAssembly.Memory"
	case jsArrayBuffer:
		return "ArrayBuffer"
	case jsView:
		return "Uint8Array view"
	case jsBytes:
		return "Uint8Array"
	}
	return "unknown value"
}

// object is one value the module holds a handle to. Only the kinds resvg reaches
// on the PNG path are modelled: a string (the SVG), the module's memory and views
// into it (how it hands a PNG back), and an error.
type object struct {
	kind   kind
	text   string
	offset uint32
	length uint32
	bytes  []byte
}

// firstHandle is where the wasm-bindgen glue starts handing out handles: below it
// are the four values it keeps alive forever (undefined, null, true, false),
// which nothing here allocates or frees.
const firstHandle = 132

// heap is that table. The module only ever passes a handle back to an import, so
// nothing but a handle's lifetime matters here.
type heap struct {
	objects []*object
	free    []uint32
}

func newHeap() *heap {
	return &heap{objects: make([]*object, firstHandle)}
}

func (h *heap) add(object *object) uint32 {
	if last := len(h.free) - 1; last >= 0 {
		handle := h.free[last]
		h.free = h.free[:last]
		h.objects[handle] = object
		return handle
	}
	h.objects = append(h.objects, object)
	return uint32(len(h.objects) - 1)
}

func (h *heap) get(handle uint32) (*object, bool) {
	if int(handle) >= len(h.objects) || h.objects[handle] == nil {
		return nil, false
	}
	return h.objects[handle], true
}

func (h *heap) drop(handle uint32) {
	if int(handle) < firstHandle || int(handle) >= len(h.objects) || h.objects[handle] == nil {
		return
	}
	h.objects[handle] = nil
	h.free = append(h.free, handle)
}

func (h *heap) take(handle uint32) (*object, bool) {
	object, ok := h.get(handle)
	if ok {
		h.drop(handle)
	}
	return object, ok
}
