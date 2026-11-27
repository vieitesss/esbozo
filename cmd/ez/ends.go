// `anchor` and `snap`: the two commands that edit a Scene in place. Go owns the
// arguments, the file and the exit code; the core owns what an Element, a Snap or
// an Anchor is, and what an end or a place word means.
package main

import (
	"fmt"
	"io"
	"os"
	"strings"

	"esbozo/internal/core"
)

// anchorArguments is what one `anchor` run was asked for: the Scene to edit, and
// the words the core judges.
type anchorArguments struct {
	scenePath string
	options   core.AnchorOptions
}

// snapArguments is what one `snap` run was asked for.
type snapArguments struct {
	scenePath string
	options   core.SnapOptions
}

// parseAnchorArguments reads `--all` with a Scene, or a Scene, an Element, an end
// and a place, and refuses anything else as a usage error. What an end and a place
// mean is the core's, so they travel as the words the command line typed.
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

// parseSnapArguments reads a Scene, an Element, an end and a target or `off`.
func parseSnapArguments(argv []string) (snapArguments, bool) {
	if !fourWords(argv) {
		return snapArguments{}, false
	}
	return snapArguments{
		scenePath: argv[0],
		options:   core.SnapOptions{ElementID: argv[1], End: argv[2], Target: argv[3]},
	}, true
}

// fourWords is the shape `anchor` and `snap` share: four words, none of them empty
// and none of them a flag.
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

// withoutWord is `argv.filter((argument) => argument !== word)`.
func withoutWord(argv []string, word string) []string {
	kept := make([]string, 0, len(argv))
	for _, argument := range argv {
		if argument != word {
			kept = append(kept, argument)
		}
	}
	return kept
}

// runAnchor is `anchor`: one end's Anchor placed on its target's outline, or every
// Snapped end frozen where it draws.
func runAnchor(argv []string, stdout, stderr io.Writer) int {
	parsed, ok := parseAnchorArguments(argv)
	if !ok {
		fmt.Fprintln(stderr, anchorUsageLine)
		return exitUsage
	}
	return editScene("anchor", parsed.scenePath, func(source []byte) (core.Edited, error) {
		return core.Anchor(source, parsed.options)
	}, stdout, stderr)
}

// runSnap is `snap`: one end attached to an Element, or written free with `off`.
func runSnap(argv []string, stdout, stderr io.Writer) int {
	parsed, ok := parseSnapArguments(argv)
	if !ok {
		fmt.Fprintln(stderr, snapUsageLine)
		return exitUsage
	}
	return editScene("snap", parsed.scenePath, func(source []byte) (core.Edited, error) {
		return core.Snap(source, parsed.options)
	}, stdout, stderr)
}

// editScene reads the Scene a command names, has the core edit it, and writes the
// answer over the file. The core refuses a Scene its own parser turns down, so
// nothing is written until the answer is a Scene the parser reads back.
func editScene(
	command, scenePath string,
	edit func(source []byte) (core.Edited, error),
	stdout, stderr io.Writer,
) int {
	source, err := os.ReadFile(scenePath)
	if err != nil {
		fmt.Fprintf(stderr, "cannot read Scene %s: %s\n", scenePath, core.NodeMessage(err, scenePath, true))
		return exitInvalidScene
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

	// 0666, as `writeFile` writes: the umask decides the rest.
	if err := os.WriteFile(scenePath, []byte(edited.Scene), 0o666); err != nil {
		fmt.Fprintf(stderr, "cannot write Scene %s: %s\n", scenePath, core.NodeMessage(err, scenePath, false))
		return exitWriteFailed
	}
	for _, line := range edited.Lines {
		fmt.Fprintln(stdout, line)
	}
	return exitOK
}
