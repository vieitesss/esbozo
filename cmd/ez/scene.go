// `render` and `check`: what the command line takes, and the files the run
// reads and writes. The boundary is the ticket's: Go owns the flags, the paths
// and the exit codes, the core owns what a Scene, a font or a stylesheet means.
package main

import (
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"esbozo/internal/core"
)

var usageLine = map[string]string{
	"render": "usage: ez render <scene> [--font <file>]",
	"check":  "usage: ez check <scene> [--font <file>] [--css <stylesheet>]",
}

// sceneArguments is what one `render` or `check` run was asked for.
type sceneArguments struct {
	scenePath string
	fontPath  string
	cssPath   string
}

// parseSceneArguments reads `<scene> [--font <file>] [--css <stylesheet>]` in
// either order, and nothing else: a second Scene, a repeated flag, a flag with
// no value, and a flag the command does not take are all wrong arguments.
func parseSceneArguments(argv []string, command string) (sceneArguments, bool) {
	var parsed sceneArguments
	given := map[string]bool{}
	for index := 0; index < len(argv); index++ {
		argument := argv[index]
		if strings.HasPrefix(argument, "--") {
			isCSS := command == "check" && argument == "--css"
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

// runScene is `render` and `check` over the Scene the arguments name.
func runScene(command string, argv []string, stdout, stderr io.Writer) int {
	parsed, ok := parseSceneArguments(argv, command)
	if !ok {
		fmt.Fprintln(stderr, usageLine[command])
		return exitUsage
	}

	source, err := os.ReadFile(parsed.scenePath)
	if err != nil {
		fmt.Fprintf(stderr, "cannot read Scene %s: %s\n", parsed.scenePath, core.NodeMessage(err, parsed.scenePath, true))
		return exitInvalidScene
	}

	// `render` draws an SVG and writes it; `check` measures and prints only.
	var answer core.Result
	var svg string
	if command == "check" {
		answer, err = core.Check(source, core.CheckOptions{
			FontPath: parsed.fontPath,
			CSSPath:  parsed.cssPath,
		})
	} else {
		var rendered core.Rendered
		rendered, err = core.Render(source, core.RenderOptions{FontPath: parsed.fontPath})
		answer, svg = rendered.Result, rendered.SVG
	}
	if err != nil {
		fmt.Fprintf(stderr, "ez could not run %s: %s\n", command, err)
		return exitWriteFailed
	}

	// A remote font falls back to Kalam without failing, and the CLI says so
	// before anything else it has to say.
	for _, note := range answer.Notes {
		fmt.Fprintln(stderr, note)
	}
	for _, problem := range answer.Problems {
		fmt.Fprintln(stderr, problem)
	}
	if !answer.OK || command == "check" {
		return answer.ExitCode
	}

	outputPath, err := svgPathFor(parsed.scenePath)
	if err != nil {
		fmt.Fprintf(stderr, "cannot name the SVG beside %s: %s\n", parsed.scenePath, err)
		return exitWriteFailed
	}
	// 0666, as `writeFile` writes: the umask decides the rest.
	if err := os.WriteFile(outputPath, []byte(svg), 0o666); err != nil {
		fmt.Fprintf(stderr, "cannot write SVG %s: %s\n", outputPath, core.NodeMessage(err, outputPath, false))
		return exitWriteFailed
	}
	fmt.Fprintln(stdout, outputPath)
	return exitOK
}

// svgPathFor is `src/paths.ts`'s rule: the SVG sits beside the Scene, named
// after the Scene's stem. The Scene is resolved first, so a relative Scene's
// output lands in the folder the run started in.
func svgPathFor(scenePath string) (string, error) {
	resolved, err := filepath.Abs(scenePath)
	if err != nil {
		return "", err
	}
	return filepath.Join(filepath.Dir(resolved), sceneStem(filepath.Base(scenePath))+".svg"), nil
}

// sceneStem is `src/paths.ts`'s rule: `.esbozo` or `.json` taken off, in any
// letter case.
func sceneStem(name string) string {
	folded := strings.ToLower(name)
	for _, extension := range []string{".esbozo", ".json"} {
		if strings.HasSuffix(folded, extension) {
			return name[:len(name)-len(extension)]
		}
	}
	return name
}
