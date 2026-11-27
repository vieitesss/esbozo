// `bundle`: the embeddable editor module, written beside the page that loads it.
// Go owns the argument, the path and the exit code; the bytes are
// `esbozo.EmbedBundle`, embedded beside the core, so the file written is the one
// this binary carries and nothing is read beside it.
package main

import (
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"esbozo"
	"esbozo/internal/core"
)

// runBundle is `bundle`: the module written to `<dir>/esbozo-<version>.js`, named
// with the path it wrote.
func runBundle(argv []string, stdout, stderr io.Writer) int {
	folder := ""
	if len(argv) == 1 {
		folder = argv[0]
	}
	if folder == "" || strings.HasPrefix(folder, "--") {
		fmt.Fprintln(stderr, bundleUsageLine)
		return exitUsage
	}

	outputPath, err := bundlePath(folder)
	if err != nil {
		fmt.Fprintf(stderr, "cannot name the bundle in %s: %s\n", folder, err)
		return exitWriteFailed
	}
	// 0666, as `writeFile` writes: the umask decides the rest. A file a page pinned
	// before this run is replaced, not appended to.
	if err := os.WriteFile(outputPath, esbozo.EmbedBundle, 0o666); err != nil {
		fmt.Fprintf(stderr, "cannot write %s: %s\n", outputPath, core.NodeMessage(err, outputPath, false))
		return exitWriteFailed
	}
	fmt.Fprintln(stdout, outputPath)
	return exitOK
}

// bundlePath is `resolve(folder, 'esbozo-<version>.js')` in `src/cli.ts`: what is
// printed is the path that was written, and a relative folder is read from the
// folder the command runs in.
func bundlePath(folder string) (string, error) {
	resolved, err := filepath.Abs(folder)
	if err != nil {
		return "", err
	}
	return filepath.Join(resolved, "esbozo-"+esbozo.Version+".js"), nil
}
