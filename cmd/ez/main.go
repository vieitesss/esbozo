package main

import (
	"fmt"
	"io"
	"os"

	"esbozo"
)

const (
	exitOK            = 0
	exitInstallFailed = 1
	exitUsage         = 2
	exitInvalidScene  = 3
	exitWriteFailed   = 4
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
		return runPNG(rest, stdout, stderr)
	case "anchor":
		return runAnchor(rest, stdout, stderr)
	case "snap":
		return runSnap(rest, stdout, stderr)
	case "skill":
		return runSkill(rest, stdout, stderr)
	case "bundle":
		return runBundle(rest, stdout, stderr)
	case "update", "upgrade":
		return runUpdate(rest, stdout, stderr)
	case "--help":
		fmt.Fprint(stdout, topLevelHelp(shouldBold(stdout)))
		return exitOK
	case "--version":
		fmt.Fprintln(stdout, esbozo.Stamp)
		return exitOK
	case "serve":
		return runServe(rest, stdout, stderr)
	}
	fmt.Fprint(stderr, topLevelHelp(false))
	return exitUsage
}
