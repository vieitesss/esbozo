// `render` and `check`: what the command line takes, and the files the run
// reads and writes.
//
// The boundary is the ticket's: Go owns the flags, the paths and the exit
// codes, the core owns what a Scene, a font or a stylesheet means. So this file
// hands the core a Scene's bytes and the paths `--font` and `--css` name, and
// takes back SVG text, the lines `ez` refuses with, and the code it exits with.
package main

import (
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"esbozo/internal/core"
)

// Exit codes the commands can answer with beyond the usage ones.
const (
	exitInvalidScene = 3
	exitWriteFailed  = 4
)

// usageLine is what each command prints when its arguments make no sense.
var usageLine = map[string]string{
	"render": "usage: ez render <scene> [--font <file>]",
	"check":  "usage: ez check <scene> [--font <file>] [--css <stylesheet>]",
}

// sceneArguments is what one `render` or `check` run was asked for; an empty
// path is a flag that was not given.
type sceneArguments struct {
	scenePath string
	fontPath  string
	cssPath   string
}

// parseSceneArguments reads `<scene> [--font <file>] [--css <stylesheet>]` in
// either order, and nothing else: a second Scene, a repeated flag, a flag with
// no value, and a flag the command does not take are all wrong arguments.
// `allowCSS` is false for `render`, which reads no stylesheet because the SVG it
// writes takes its family from the page.
func parseSceneArguments(argv []string, allowCSS bool) (sceneArguments, bool) {
	var parsed sceneArguments
	given := map[string]bool{}
	for index := 0; index < len(argv); index++ {
		argument := argv[index]
		if strings.HasPrefix(argument, "--") {
			isCSS := allowCSS && argument == "--css"
			if argument != "--font" && !isCSS {
				return sceneArguments{}, false
			}
			value := ""
			if index+1 < len(argv) {
				value = argv[index+1]
			}
			if value == "" || strings.HasPrefix(value, "--") || given[argument] {
				return sceneArguments{}, false
			}
			given[argument] = true
			if isCSS {
				parsed.cssPath = value
			} else {
				parsed.fontPath = value
			}
			index++
			continue
		}
		if argument == "" || parsed.scenePath != "" {
			return sceneArguments{}, false
		}
		parsed.scenePath = argument
	}
	if parsed.scenePath == "" {
		return sceneArguments{}, false
	}
	return parsed, true
}

// runScene is `render` and `check`: one command over the Scene the arguments
// name, and, for `render`, the SVG written beside it before its path is printed.
func runScene(command string, argv []string, stdout, stderr io.Writer) int {
	parsed, ok := parseSceneArguments(argv, command == "check")
	if !ok {
		fmt.Fprintln(stderr, usageLine[command])
		return exitUsage
	}

	source, err := os.ReadFile(parsed.scenePath)
	if err != nil {
		fmt.Fprintf(stderr, "cannot read Scene %s: %s\n", parsed.scenePath, core.NodeMessage(err, parsed.scenePath, true))
		return exitInvalidScene
	}

	answer, err := core.Run(command, source, core.Options{
		FontPath: parsed.fontPath,
		CSSPath:  parsed.cssPath,
	})
	if err != nil {
		fmt.Fprintf(stderr, "ez could not run %s: %s\n", command, err)
		return exitWriteFailed
	}

	// Notes first: a remote font falls back to Kalam without failing, and the
	// CLI says so before anything else it has to say.
	for _, note := range answer.Notes {
		fmt.Fprintln(stderr, note)
	}
	for _, problem := range answer.Problems {
		fmt.Fprintln(stderr, problem)
	}
	if !answer.OK || command == "check" {
		return answer.ExitCode
	}

	outputPath := svgPathFor(parsed.scenePath)
	// 0666, as `writeFile` writes: the umask decides the rest.
	if err := os.WriteFile(outputPath, []byte(answer.SVG), 0o666); err != nil {
		fmt.Fprintf(stderr, "cannot write SVG %s: %s\n", outputPath, core.NodeMessage(err, outputPath, false))
		return exitWriteFailed
	}
	fmt.Fprintln(stdout, outputPath)
	return exitOK
}

// svgPathFor is `src/paths.ts`'s rule: the SVG sits beside the Scene, named
// after the Scene's stem, with `.esbozo` or `.json` taken off.
func svgPathFor(scenePath string) string {
	return filepath.Join(filepath.Dir(absolute(scenePath)), sceneStem(filepath.Base(scenePath))+".svg")
}

// absolute is the Scene path as the CLI prints what it wrote: `path.resolve`
// keeps a relative Scene's output in the folder the run started in.
func absolute(scenePath string) string {
	absolutePath, err := filepath.Abs(scenePath)
	if err != nil {
		return scenePath
	}
	return absolutePath
}

// sceneStem is a file name with `.esbozo` or `.json` taken off, in any letter
// case, as `sceneStem` in `src/paths.ts` takes it.
func sceneStem(name string) string {
	folded := strings.ToLower(name)
	for _, extension := range []string{".esbozo", ".json"} {
		if strings.HasSuffix(folded, extension) {
			return name[:len(name)-len(extension)]
		}
	}
	return name
}
