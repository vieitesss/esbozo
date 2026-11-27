// `png`: what the command line takes, and the file the run writes. Go owns the
// flags, the paths and the exit codes; the core owns the palette, the outlines
// and what a Scene is.
package main

import (
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"esbozo/internal/core"
)

// pngUsageLine is `USAGE_LINE.png` in `src/help.ts`, word for word.
const pngUsageLine = "usage: ez png <scene> --theme light|dark [--css <stylesheet>]" +
	" [--ink <colour>] [--paper <colour>] [--muted <colour>] [--font <file>]"

// pngArguments is what one `png` run was asked for.
type pngArguments struct {
	scenePath string
	theme     string
	cssPath   string
	ink       string
	paper     string
	muted     string
	fontPath  string
}

// parsePNGArguments reads the flags in either order, and nothing else: a second
// Scene, a flag with no value, and a flag `png` does not take are all wrong
// arguments. A repeated flag takes its last value, as `parsePngArguments` in
// `src/cli.ts` lets it.
func parsePNGArguments(argv []string) (pngArguments, bool) {
	var parsed pngArguments
	for index := 0; index < len(argv); index++ {
		argument := argv[index]
		if strings.HasPrefix(argument, "--") {
			value := ""
			if index+1 < len(argv) {
				value = argv[index+1]
			}
			if value == "" || strings.HasPrefix(value, "--") {
				return pngArguments{}, false
			}
			switch argument {
			case "--theme":
				parsed.theme = value
			case "--css":
				parsed.cssPath = value
			case "--ink":
				parsed.ink = value
			case "--paper":
				parsed.paper = value
			case "--muted":
				parsed.muted = value
			case "--font":
				parsed.fontPath = value
			default:
				return pngArguments{}, false
			}
			index++
			continue
		}
		if argument == "" || parsed.scenePath != "" {
			return pngArguments{}, false
		}
		parsed.scenePath = argument
	}
	if parsed.scenePath == "" || (parsed.theme != "light" && parsed.theme != "dark") {
		return pngArguments{}, false
	}
	return parsed, true
}

// runPNG is `png`: the image beside the Scene, named for its theme.
func runPNG(argv []string, stdout, stderr io.Writer) int {
	parsed, ok := parsePNGArguments(argv)
	if !ok {
		fmt.Fprintln(stderr, pngUsageLine)
		return exitUsage
	}

	source, err := os.ReadFile(parsed.scenePath)
	if err != nil {
		fmt.Fprintf(stderr, "cannot read Scene %s: %s\n", parsed.scenePath, core.NodeMessage(err, parsed.scenePath, true))
		return exitInvalidScene
	}

	answer, err := core.Run(core.PNG, source, core.Options{
		FontPath: parsed.fontPath,
		CSSPath:  parsed.cssPath,
		Theme:    parsed.theme,
		Ink:      parsed.ink,
		Paper:    parsed.paper,
		Muted:    parsed.muted,
	})
	if err != nil {
		fmt.Fprintf(stderr, "ez could not run png: %s\n", err)
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
	if !answer.OK {
		return answer.ExitCode
	}

	outputPath, err := pngPathFor(parsed.scenePath, parsed.theme)
	if err != nil {
		fmt.Fprintf(stderr, "cannot name the PNG beside %s: %s\n", parsed.scenePath, err)
		return exitWriteFailed
	}
	// 0666, as `writeFile` writes: the umask decides the rest.
	if err := os.WriteFile(outputPath, answer.PNG, 0o666); err != nil {
		fmt.Fprintf(stderr, "cannot write PNG %s: %s\n", outputPath, core.NodeMessage(err, outputPath, false))
		return exitWriteFailed
	}
	fmt.Fprintln(stdout, outputPath)
	return exitOK
}

// pngPathFor is the SVG's rule one suffix further on: `sketch.esbozo` gives
// `sketch.light.png` and `sketch.dark.png`.
func pngPathFor(scenePath, theme string) (string, error) {
	resolved, err := filepath.Abs(scenePath)
	if err != nil {
		return "", err
	}
	return filepath.Join(filepath.Dir(resolved), sceneStem(filepath.Base(scenePath))+"."+theme+".png"), nil
}
