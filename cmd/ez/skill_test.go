package main

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// TestSkillInstallReportsAFolderItCannotName: a folder that cannot be resolved is
// a write that failed, not a usage error — `ez bundle` reports the path it could
// not name with exit 4, so `ez skill install` does too, naming the file it was
// asked to write. A folder the run started in and something removed is the one way
// to reach it without a broken `$HOME`.
func TestSkillInstallReportsAFolderItCannotName(t *testing.T) {
	gone := filepath.Join(t.TempDir(), "gone")
	if err := os.Mkdir(gone, 0o777); err != nil {
		t.Fatal(err)
	}
	t.Chdir(gone)
	if err := os.Remove(gone); err != nil {
		t.Fatal(err)
	}

	var stdout, stderr bytes.Buffer
	code := run([]string{"skill", "install", "--dir", "skills"}, &stdout, &stderr)

	if code != exitWriteFailed {
		t.Errorf("ez skill install answered %d, want %d: %s", code, exitWriteFailed, stderr.String())
	}
	if prefix := "cannot write skills/esbozo/SKILL.md: "; !strings.HasPrefix(stderr.String(), prefix) {
		t.Errorf("stderr is %q, want the file it could not write: %q", stderr.String(), prefix)
	}
	if stdout.Len() != 0 {
		t.Errorf("stdout is %q, want nothing: no file was written", stdout.String())
	}
}
