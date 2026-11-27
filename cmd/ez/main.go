// Command ez is the Go binary that runs the TypeScript core.
//
// The surface is `src/cli.ts`'s, and this file decides what each command is
// given and what it exits with; what a Scene, a font or a stylesheet means is
// the core's, which `render`, `check`, `png`, `anchor` and `snap` hand bytes and
// get text or an image back from.
//
// Surface (the commands marked * are not ported yet):
//
//	ez render <scene> [--font <file>]
//	ez check <scene> [--font <file>] [--css <stylesheet>]
//	ez png <scene> --theme light|dark [--css <stylesheet>] [--ink <colour>]
//	      [--paper <colour>] [--muted <colour>] [--font <file>]
//	ez anchor <scene> <element> <start|end> <place>
//	ez anchor <scene> --all
//	ez snap <scene> <element> <start|end> <target|off>
//	ez skill [install [--dir <path>]]
//	ez serve* / bundle*
//	ez --version
package main

import (
	"fmt"
	"io"
	"os"

	"esbozo"
)

// The codes the commands decide for themselves, as `EXIT` in `src/cli.ts`
// defines them; 5 and 6 are the core's, which it refuses a Scene with.
const (
	exitOK           = 0
	exitUsage        = 2
	exitInvalidScene = 3
	exitWriteFailed  = 4
)

func main() {
	os.Exit(run(os.Args[1:], os.Stdout, os.Stderr))
}

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
	case "render", "check":
		return runScene(command, rest, stdout, stderr)
	case "png":
		return runPng(rest, stdout, stderr)
	case "anchor":
		return runAnchor(rest, stdout, stderr)
	case "snap":
		return runSnap(rest, stdout, stderr)
	case "skill":
		return runSkill(rest, stdout, stderr)
	case "--help":
		fmt.Fprint(stdout, topLevelHelp(shouldBold(stdout)))
		return exitOK
	case "--version":
		fmt.Fprintln(stdout, esbozo.Stamp)
		return exitOK
	case "serve", "bundle":
		fmt.Fprintf(stderr, "ez %s is not yet ported to Go\n", command)
		return exitUsage
	}
	// No command, or one no `ez` has: the help lists what there is, as before.
	fmt.Fprint(stderr, topLevelHelp(false))
	return exitUsage
}
