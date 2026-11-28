---
status: accepted
---

# `ez` is a Go binary that runs the TypeScript core in goja

Installing esbozo should need nothing already on the machine, and the download
should be light. So `ez` is one static Go binary per platform (linux and darwin,
x64 and arm64). Go owns the CLI, `serve`, `update` and all I/O. The core that
parses, lays out and draws a Scene (`scene`, `layout`, `renderer`, `geometry`
with roughjs and opentype.js) stays TypeScript. It is bundled into one script
that the binary embeds and runs in goja, so the editor and `ez render` still run
the same code and an SVG from either is byte-identical. PNGs come from the same
resvg wasm, run by wazero.

## Gate

The plan holds only if a spike on the RPi (linux-arm64) renders every fixture
Scene with byte-identical SVG, a binary of at most 25 MB, and the largest
fixture in no more than 2× today's `ez render` time. If it fails, the fallback
is the Rust option below, not a Go port.

## Considered Options

- Bun `--compile`: 101 MB on disk (40 MB gzipped), 97 MB of it the runtime.
  Any binary carrying a JS runtime is that heavy; Node 22 is 122 MB.
- A tarball of `dist/` run with the user's Node 22: small, but every user needs
  a recent Node first.
- Publishing to npm: updates would belong to npm, and it still needs Node.
- Port the core to Go and keep the TS copy for the editor: two renderers held
  equal by golden tests, forever.
- Port the core to Go and compile it to wasm for the editor: one renderer, but
  Go wasm is megabytes against `embed.js`'s 201 KB.
- Port the core to Rust, native for `ez` and wasm for the editor: the
  smallest CLI (about 5–10 MB) and native resvg, but weeks of porting, an embed
  2–4× heavier, a wasm call on every pointer move, and every existing SVG
  changes once because roughr does not reproduce roughjs. Kept as the fallback.

## Consequences

- The TS toolchain stays: it builds the editor, the core bundle the binary
  embeds, and runs the tests. `go build` needs `pnpm build` first.
- Speed of the core is goja's, not V8's.
- Go never holds a Scene rule. It passes bytes to the core and gets back SVG
  text or a list of problems, so the editor and `ez` cannot disagree about a
  Scene.
- `go install` is not supported: the binary embeds `dist/`, which is built,
  not checked in. The install script and Docker are the only ways to install.
- The tests that run `ez` as a subprocess are the spec for the port. The TS
  CLI is deleted in the commit where they pass against the Go binary.
