package main

import (
	"fmt"
	"io"
	"os"
	"strings"

	"esbozo/internal/core"
	"esbozo/internal/nodeerr"
)

type anchorArguments struct {
	scenePath string
	options   core.AnchorOptions
}

type snapArguments struct {
	scenePath string
	options   core.SnapOptions
}

func parseAnchorArguments(argv []string) (anchorArguments, bool) {
	if hasWord(argv, "--all") {
		rest := withoutWord(argv, "--all")
		if len(rest) != 1 || rest[0] == "" || strings.HasPrefix(rest[0], "--") {
			return anchorArguments{}, false
		}
		return anchorArguments{scenePath: rest[0], options: core.AnchorOptions{All: true}}, true
	}
	if !fourWords(argv) {
		return anchorArguments{}, false
	}
	return anchorArguments{
		scenePath: argv[0],
		options:   core.AnchorOptions{ElementID: argv[1], End: argv[2], Place: argv[3]},
	}, true
}

func parseSnapArguments(argv []string) (snapArguments, bool) {
	if !fourWords(argv) {
		return snapArguments{}, false
	}
	return snapArguments{
		scenePath: argv[0],
		options:   core.SnapOptions{ElementID: argv[1], End: argv[2], Target: argv[3]},
	}, true
}

func fourWords(argv []string) bool {
	if len(argv) != 4 {
		return false
	}
	for _, word := range argv {
		if word == "" || strings.HasPrefix(word, "--") {
			return false
		}
	}
	return true
}

func hasWord(argv []string, word string) bool {
	for _, argument := range argv {
		if argument == word {
			return true
		}
	}
	return false
}

func withoutWord(argv []string, word string) []string {
	kept := make([]string, 0, len(argv))
	for _, argument := range argv {
		if argument != word {
			kept = append(kept, argument)
		}
	}
	return kept
}

func runAnchor(argv []string, stdout, stderr io.Writer) int {
	parsed, ok := parseAnchorArguments(argv)
	if !ok {
		fmt.Fprintln(stderr, usageLine["anchor"])
		return exitUsage
	}
	return editScene("anchor", parsed.scenePath, func(source []byte) (core.Edited, error) {
		return core.Anchor(source, parsed.options)
	}, stdout, stderr)
}

func runSnap(argv []string, stdout, stderr io.Writer) int {
	parsed, ok := parseSnapArguments(argv)
	if !ok {
		fmt.Fprintln(stderr, usageLine["snap"])
		return exitUsage
	}
	return editScene("snap", parsed.scenePath, func(source []byte) (core.Edited, error) {
		return core.Snap(source, parsed.options)
	}, stdout, stderr)
}

func editScene(
	command, scenePath string,
	edit func(source []byte) (core.Edited, error),
	stdout, stderr io.Writer,
) int {
	source, readErr := os.ReadFile(scenePath)
	if readErr != nil {
		source = nil
	}

	edited, err := edit(source)
	if err != nil {
		fmt.Fprintf(stderr, "ez could not run %s: %s\n", command, err)
		return exitWriteFailed
	}
	for _, problem := range edited.Problems {
		fmt.Fprintln(stderr, problem)
	}
	if !edited.OK {
		return edited.ExitCode
	}
	if readErr != nil {
		fmt.Fprintf(stderr, "cannot read Scene %s: %s\n", scenePath, nodeerr.Message(readErr, scenePath, true))
		return exitInvalidScene
	}

	if err := os.WriteFile(scenePath, []byte(edited.Scene), 0o666); err != nil {
		fmt.Fprintf(stderr, "cannot write Scene %s: %s\n", scenePath, nodeerr.Message(err, scenePath, false))
		return exitWriteFailed
	}
	for _, line := range edited.Lines {
		fmt.Fprintln(stdout, line)
	}
	return exitOK
}
