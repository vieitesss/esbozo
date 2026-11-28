package resvg

import (
	"context"
	"encoding/binary"
	"errors"
	"fmt"

	"github.com/tetratelabs/wazero/api"
)

func (one *rasteriser) installWbg() error {
	imports := []struct {
		name string
		fn   any
	}{
		{"__wbg_new_28c511d9baebfa89", one.newError},
		{"__wbindgen_memory", one.memoryObject},
		{"__wbg_buffer_12d079cc21e14bdb", one.bufferOf},
		{"__wbg_newwithbyteoffsetandlength_aa4a17c33a06e5cb", one.viewOf},
		{"__wbindgen_object_drop_ref", one.dropRef},
		{"__wbg_new_63b92bc8671ed464", one.copyOf},
		{"__wbg_instanceof_Uint8Array_2b3bbecd033d19f6", one.isUint8Array},
		{"__wbindgen_string_get", one.stringGet},
		{"__wbindgen_throw", one.throw},

		// wazero requires every declared wasm import to be bound at instantiation;
		// the imports below are only reached by imagesToResolve and custom font buffers.
		{"__wbindgen_string_new", func(context.Context, api.Module, uint32, uint32) uint32 {
			panic(notReached("__wbindgen_string_new"))
		}},
		{"__wbg_values_839f3396d5aac002", func(context.Context, api.Module, uint32) uint32 {
			panic(notReached("__wbg_values_839f3396d5aac002"))
		}},
		{"__wbg_next_196c84450b364254", func(context.Context, api.Module, uint32) uint32 {
			panic(notReached("__wbg_next_196c84450b364254"))
		}},
		{"__wbg_done_298b57d23c0fc80c", func(context.Context, api.Module, uint32) uint32 {
			panic(notReached("__wbg_done_298b57d23c0fc80c"))
		}},
		{"__wbg_value_d93c65011f51a456", func(context.Context, api.Module, uint32) uint32 {
			panic(notReached("__wbg_value_d93c65011f51a456"))
		}},
		{"__wbg_new_16b304a2cfa7ff4a", func(context.Context, api.Module) uint32 {
			panic(notReached("__wbg_new_16b304a2cfa7ff4a"))
		}},
		{"__wbg_push_a5b05aedc7234f9f", func(context.Context, api.Module, uint32, uint32) uint32 {
			panic(notReached("__wbg_push_a5b05aedc7234f9f"))
		}},
		{"__wbg_length_c20a40f15020d68a", func(context.Context, api.Module, uint32) uint32 {
			panic(notReached("__wbg_length_c20a40f15020d68a"))
		}},
		{"__wbg_set_a47bac70306a19a7", func(context.Context, api.Module, uint32, uint32, uint32) {
			panic(notReached("__wbg_set_a47bac70306a19a7"))
		}},
	}

	builder := one.runtime.NewHostModuleBuilder("wbg")
	for _, import_ := range imports {
		builder.NewFunctionBuilder().WithFunc(import_.fn).Export(import_.name)
	}
	if _, err := builder.Instantiate(one.ctx); err != nil {
		return fmt.Errorf("cannot install resvg's host imports: %w", err)
	}
	return nil
}

func notReached(name string) error {
	return fmt.Errorf("resvg called %s, which this host does not implement", name)
}

func (one *rasteriser) newError(_ context.Context, module api.Module, pointer, length uint32) uint32 {
	return one.heap.add(&object{kind: jsError, text: readText(module, pointer, length)})
}

func (one *rasteriser) memoryObject(_ context.Context, _ api.Module) uint32 {
	return one.heap.add(&object{kind: jsMemory})
}

func (one *rasteriser) bufferOf(_ context.Context, _ api.Module, memory uint32) uint32 {
	one.held(memory)
	return one.heap.add(&object{kind: jsArrayBuffer})
}

func (one *rasteriser) viewOf(_ context.Context, _ api.Module, buffer, offset, length uint32) uint32 {
	one.held(buffer)
	return one.heap.add(&object{kind: jsView, offset: offset, length: length})
}

func (one *rasteriser) dropRef(_ context.Context, _ api.Module, handle uint32) {
	one.heap.drop(handle)
}

// Memory.Read aliases wasm linear memory; copy before __wbg_renderedimage_free reclaims the buffer.
func (one *rasteriser) copyOf(_ context.Context, module api.Module, handle uint32) uint32 {
	source := one.held(handle)
	if source.kind != jsView {
		panic(fmt.Errorf("resvg copied a %s into a Uint8Array", source.kind))
	}
	bytes, ok := module.Memory().Read(source.offset, source.length)
	if !ok {
		panic(fmt.Errorf("resvg copied %d bytes at %d, past the end of its memory", source.length, source.offset))
	}
	copied := make([]byte, len(bytes))
	copy(copied, bytes)
	return one.heap.add(&object{kind: jsBytes, bytes: copied})
}

func (one *rasteriser) isUint8Array(_ context.Context, _ api.Module, handle uint32) uint32 {
	source := one.held(handle)
	if source.kind == jsView || source.kind == jsBytes {
		return 1
	}
	return 0
}

// wasm-bindgen __wbindgen_string_get ABI: write (ptr, len) to retptr, or (0, 0) for a non-string handle.
func (one *rasteriser) stringGet(_ context.Context, module api.Module, retptr, handle uint32) {
	var pointer, length uint32
	if source := one.held(handle); source.kind == jsString {
		allocated, err := one.malloc(len(source.text))
		if err != nil {
			panic(err)
		}
		if !module.Memory().Write(allocated, []byte(source.text)) {
			panic(fmt.Errorf("resvg's memory cannot hold %d bytes of SVG", len(source.text)))
		}
		pointer, length = allocated, uint32(len(source.text))
	}
	result := make([]byte, 8)
	binary.LittleEndian.PutUint32(result, pointer)
	binary.LittleEndian.PutUint32(result[4:], length)
	if !module.Memory().Write(retptr, result) {
		panic(fmt.Errorf("resvg asked for a string result at %d, past the end of its memory", retptr))
	}
}

func (one *rasteriser) throw(_ context.Context, module api.Module, pointer, length uint32) {
	panic(errors.New(readText(module, pointer, length)))
}

func (one *rasteriser) held(handle uint32) *object {
	object, ok := one.heap.get(handle)
	if !ok {
		panic(fmt.Errorf("resvg passed handle %d, which the heap does not hold", handle))
	}
	return object
}

func readText(module api.Module, pointer, length uint32) string {
	bytes, ok := module.Memory().Read(pointer, length)
	if !ok {
		panic(fmt.Errorf("resvg read %d bytes at %d, past the end of its memory", length, pointer))
	}
	return string(bytes)
}
