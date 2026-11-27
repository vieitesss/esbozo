// Package resvg rasterises SVGs using @resvg/resvg-wasm in wazero.
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

// Rasterise renders svg (with text already outlined) to PNG bytes using
// @resvg/resvg-wasm options JSON. The wasm module is initialised once per process.
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

func shared() (*rasteriser, error) {
	sharedOnce.Do(func() { sharedModule, sharedErr = newRasteriser(cacheDir()) })
	return sharedModule, sharedErr
}

func cacheDir() string {
	base, err := os.UserCacheDir()
	if err != nil {
		return ""
	}
	return filepath.Join(base, "esbozo", "wazero")
}

// resvg's wasm holds global state (allocator, shadow stack pointer), so calls serialise on mu.
type rasteriser struct {
	ctx     context.Context
	runtime wazero.Runtime
	module  api.Module
	mu      sync.Mutex
	heap    *heap
}

func newRasteriser(dir string) (*rasteriser, error) {
	cache := compilationCache(dir)
	one, err := startWith(cache)
	if cache == nil || err == nil {
		return one, err
	}

	// wazero fails compilation outright on a corrupted cache entry; retry without a cache.
	return startWith(nil)
}

func startWith(cache wazero.CompilationCache) (*rasteriser, error) {
	ctx := context.Background()
	one := &rasteriser{ctx: ctx}

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

func (one *rasteriser) rasterise(svg, options string) ([]byte, error) {
	one.mu.Lock()
	defer one.mu.Unlock()
	one.heap = newHeap()

	// wasm-bindgen reserves 16 bytes on the downward-growing shadow stack for each call's return area.
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

func withoutStackTrace(err error) error {
	message, _, _ := strings.Cut(err.Error(), "\nwasm stack trace:")
	return errors.New(message)
}

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

// wazero fails compilation if it cannot write to the cache directory, so probe
// writability first and return nil on any failure.
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

type object struct {
	kind   kind
	text   string
	offset uint32
	length uint32
	bytes  []byte
}

// firstHandle is where the wasm-bindgen glue starts freeing handles: it drops
// nothing below 132, which keeps undefined, null, true and false for good.
const firstHandle = 132

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
