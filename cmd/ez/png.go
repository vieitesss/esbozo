package main

import (
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"esbozo/internal/core"
	"esbozo/internal/nodeerr"
)

type pngArguments struct {
	scenePath string
	theme     string
	cssPath   string
	ink       string
	paper     string
	muted     string
	fontPath  string
}

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

func runPNG(argv []string, stdout, stderr io.Writer) int {
	parsed, ok := parsePNGArguments(argv)
	if !ok {
		fmt.Fprintln(stderr, usageLine["png"])
		return exitUsage
	}

	source, err := os.ReadFile(parsed.scenePath)
	if err != nil {
		fmt.Fprintf(stderr, "cannot read Scene %s: %s\n", parsed.scenePath, nodeerr.Message(err, parsed.scenePath, true))
		return exitInvalidScene
	}

	image, err := core.PNG(source, core.PNGOptions{
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

	for _, note := range image.Notes {
		fmt.Fprintln(stderr, note)
	}
	for _, problem := range image.Problems {
		fmt.Fprintln(stderr, problem)
	}
	if !image.OK {
		return image.ExitCode
	}

	outputPath, err := pngPathFor(parsed.scenePath, parsed.theme)
	if err != nil {
		fmt.Fprintf(stderr, "cannot name the PNG beside %s: %s\n", parsed.scenePath, err)
		return exitWriteFailed
	}
	if err := os.WriteFile(outputPath, image.PNG, 0o666); err != nil {
		fmt.Fprintf(stderr, "cannot write PNG %s: %s\n", outputPath, nodeerr.Message(err, outputPath, false))
		return exitWriteFailed
	}
	fmt.Fprintln(stdout, outputPath)
	return exitOK
}

func pngPathFor(scenePath, theme string) (string, error) {
	resolved, err := filepath.Abs(scenePath)
	if err != nil {
		return "", err
	}
	return filepath.Join(filepath.Dir(resolved), sceneStem(filepath.Base(scenePath))+"."+theme+".png"), nil
}
