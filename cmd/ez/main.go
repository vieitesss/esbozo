// Command ez is the Go binary that runs the TypeScript core.
//
// The surface is `src/cli.ts`'s, and this file decides what each command is
// given and what it exits with; what a Scene, a font or a stylesheet means is
// the core's, which `render` and `check` hand bytes and get text back from.
//
// Surface (the commands marked * are not ported yet):
//
//	ez render <scene> [--font <file>]
//	ez check <scene> [--font <file>] [--css <stylesheet>]
//	ez anchor* / snap* / png* / serve* / bundle* / skill*
//
// `render` writes `<name>.svg` beside the Scene and prints that path. `check`
// reports what is wrong with a Scene and prints nothing when it is clean, so a
// script can rely on the exit code alone.
//
// Exit codes — the one place they are defined, `EXIT`:
//
//	0  the Scene is clean or was rendered
//	2  wrong arguments (unknown command, missing or extra arguments, bad flag)
//	3  the Scene could not be read or parsed
//	4  the output could not be written
//	5  missing theme values, or a missing or unreadable font
//	6  a Label that does not fit its Element (see `ez check`)
//
// Problems are plain text, one per line, on stderr, and name the Element they
// belong to: `a: width must be at least 1 pixel, got 0`.
package main

import (
	"fmt"
	"io"
	"os"
)

// Exit codes, as `EXIT` in `src/cli.ts` defines them.
const (
	exitOK    = 0
	exitUsage = 2
)

func main() {
	os.Exit(run(os.Args[1:], os.Stdout, os.Stderr))
}

// run is the command line, over the streams a run reads and writes: the exit
// code it answers with is the code the process exits with.
func run(argv []string, stdout, stderr io.Writer) int {
	command, rest := "", []string(nil)
	if len(argv) > 0 {
		command, rest = argv[0], argv[1:]
	}
	if command == "help" {
		return runHelp(rest, stdout, stderr)
	}
	if topic := helpTopicFor(command, rest); topic != "" {
		fmt.Fprint(stdout, commandHelp(topic, shouldBold(stdout)))
		return exitOK
	}
	switch command {
	case "--help":
		fmt.Fprint(stdout, topLevelHelp(shouldBold(stdout)))
		return exitOK
	case "anchor", "snap", "png", "serve", "bundle", "skill":
		fmt.Fprintf(stderr, "ez %s is not yet ported to Go\n", command)
		return exitUsage
	}
	// No command, or one no `ez` has: the help lists what there is, as before.
	fmt.Fprint(stderr, topLevelHelp(false))
	return exitUsage
}
