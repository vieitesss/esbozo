package main

import (
	"fmt"
	"io"
	"os"
	"strings"

	"esbozo/internal/core"
	"esbozo/internal/nodeerr"
)

func parseAnchorArguments(argv []string) (core.AnchorOptions, bool) {
	if hasWord(argv, "--all") {
		rest := withoutWord(argv, "--all")
		if len(rest) != 1 || rest[0] == "" || strings.HasPrefix(rest[0], "--") {
			return core.AnchorOptions{}, false
		}
		return core.AnchorOptions{ScenePath: rest[0], All: true}, true
	}
	if !fourWords(argv) {
		return core.AnchorOptions{}, false
	}
	return core.AnchorOptions{
		ScenePath: argv[0],
		ElementID: argv[1],
		End:       argv[2],
		Place:     argv[3],
	}, true
}

func parseSnapArguments(argv []string) (core.SnapOptions, bool) {
	if !fourWords(argv) {
		return core.SnapOptions{}, false
	}
	return core.SnapOptions{
		ScenePath: argv[0],
		ElementID: argv[1],
		End:       argv[2],
		Target:    argv[3],
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
	options, ok := parseAnchorArguments(argv)
	if !ok {
		fmt.Fprintln(stderr, usageLine["anchor"])
		return exitUsage
	}
	return editScene("anchor", options.ScenePath, func() (core.Edited, error) {
		return core.Anchor(options)
	}, stdout, stderr)
}

func runSnap(argv []string, stdout, stderr io.Writer) int {
	options, ok := parseSnapArguments(argv)
	if !ok {
		fmt.Fprintln(stderr, usageLine["snap"])
		return exitUsage
	}
	return editScene("snap", options.ScenePath, func() (core.Edited, error) {
		return core.Snap(options)
	}, stdout, stderr)
}

func editScene(
	command, scenePath string,
	edit func() (core.Edited, error),
	stdout, stderr io.Writer,
) int {
	edited, err := edit()
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

	if err := os.WriteFile(scenePath, []byte(edited.Scene), 0o666); err != nil {
		fmt.Fprintf(stderr, "cannot write Scene %s: %s\n", scenePath, nodeerr.Message(err, scenePath, false))
		return exitWriteFailed
	}
	for _, line := range edited.Lines {
		fmt.Fprintln(stdout, line)
	}
	return exitOK
}
