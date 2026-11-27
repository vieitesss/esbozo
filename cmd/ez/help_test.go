package main

import (
	"os"
	"strings"
	"testing"
)

// TestHelpIsPlainOnACharacterDeviceThatIsNoTerminal is the first half of what
// finding 1 asks: `/dev/null` is a character device, which is as far as a file's
// mode gets, and it is no terminal — Node's `isTTY` says so, and `node
// dist/cli.js --help > /dev/null` is plain text. `ez --help > /dev/null` too.
func TestHelpIsPlainOnACharacterDeviceThatIsNoTerminal(t *testing.T) {
	unsetenv(t, "NO_COLOR")
	devNull, err := os.OpenFile(os.DevNull, os.O_WRONLY, 0)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = devNull.Close() }()

	if shouldBold(devNull) {
		t.Errorf("%s is no terminal, so what is written to it stays plain", os.DevNull)
	}
	if help := topLevelHelp(shouldBold(devNull)); strings.Contains(help, "\x1b") {
		t.Errorf("the help written to %s carries bold", os.DevNull)
	}
}

// TestNoColorTurnsBoldOffWhenItIsSetEmpty is the second half: Node turns bold off
// when `NO_COLOR` is there at all, an empty value included, so a terminal is
// bold only while the variable is unset.
func TestNoColorTurnsBoldOffWhenItIsSetEmpty(t *testing.T) {
	unsetenv(t, "NO_COLOR")
	terminal := askTerminal(t)

	t.Setenv("NO_COLOR", "")
	if shouldBold(terminal) {
		t.Errorf("NO_COLOR set empty turns bold off in Node, so it has to here too")
	}
}

// askTerminal is a terminal to ask the helper about, or a skip. A pty master is
// one, and the help is never written to it, so no slave side is opened.
//
// It is also the check that this test can say anything: `NO_COLOR` is unset by
// the caller, so a terminal that is not bold here is not the stream this half is
// about, and a run that skips says so.
func askTerminal(t *testing.T) *os.File {
	t.Helper()
	const ptmx = "/dev/ptmx"
	master, err := os.OpenFile(ptmx, os.O_RDWR, 0)
	if err != nil {
		t.Skipf("no %s to ask about a terminal: %v", ptmx, err)
	}
	t.Cleanup(func() { _ = master.Close() })
	if !shouldBold(master) {
		t.Skipf("%s is no terminal on this platform, so there is none to ask", ptmx)
	}
	return master
}

// unsetenv removes `name` for this test and puts back what was there.
func unsetenv(t *testing.T, name string) {
	t.Helper()
	was, had := os.LookupEnv(name)
	if err := os.Unsetenv(name); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if had {
			_ = os.Setenv(name, was)
			return
		}
		_ = os.Unsetenv(name)
	})
}
