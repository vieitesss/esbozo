// Command ez is the Go binary that runs the TypeScript core.
//
// It is a stub: `ez render` and `ez check` are the next ticket's, and this file
// exists so that `pnpm build` has a `./cmd/ez` to compile and the build, the
// binary's size and the continuous integration's `go vet`/`go test` can be held
// to a real command. Until then it answers what `ez` with no command answers,
// which is the usage line and the usage exit code.
package main

import (
	"fmt"
	"os"
)

// usage is the shape the commands will take; it is printed to stderr so that
// `ez > out.svg` never captures it.
const usage = "usage: ez render <scene.json>\n" +
	"       ez check <scene.json>\n"

func main() {
	fmt.Fprint(os.Stderr, usage)
	os.Exit(2)
}
