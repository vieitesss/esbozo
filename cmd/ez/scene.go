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

type sceneArguments struct {
	scenePath string
	fontPath  string
	cssPath   string
}

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

func runScene(command string, argv []string, stdout, stderr io.Writer) int {
	parsed, ok := parseSceneArguments(argv, command)
	if !ok {
		fmt.Fprintln(stderr, usageLine[command])
		return exitUsage
	}

	source, err := os.ReadFile(parsed.scenePath)
	if err != nil {
		fmt.Fprintf(stderr, "cannot read Scene %s: %s\n", parsed.scenePath, nodeerr.Message(err, parsed.scenePath, true))
		return exitInvalidScene
	}

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
	if err := os.WriteFile(outputPath, []byte(svg), 0o666); err != nil {
		fmt.Fprintf(stderr, "cannot write SVG %s: %s\n", outputPath, nodeerr.Message(err, outputPath, false))
		return exitWriteFailed
	}
	fmt.Fprintln(stdout, outputPath)
	return exitOK
}

func svgPathFor(scenePath string) (string, error) {
	resolved, err := filepath.Abs(scenePath)
	if err != nil {
		return "", err
	}
	names, err := core.Names(filepath.Base(scenePath), "")
	if err != nil {
		return "", err
	}
	return filepath.Join(filepath.Dir(resolved), names.SVG), nil
}
