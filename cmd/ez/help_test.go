package main

import (
	"os"
	"strings"
	"testing"
)

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

func TestNoColorTurnsBoldOffWhenItIsSetEmpty(t *testing.T) {
	unsetenv(t, "NO_COLOR")
	terminal := askTerminal(t)

	t.Setenv("NO_COLOR", "")
	if shouldBold(terminal) {
		t.Errorf("NO_COLOR set empty turns bold off")
	}
}

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
