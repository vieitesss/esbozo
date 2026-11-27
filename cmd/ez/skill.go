// `skill`: the agent skill this binary carries, printed or installed. Go owns the
// arguments, the folder and the exit code; the bytes are `esbozo.Skill`, embedded
// beside the core, so what a person installs is what this binary runs.
package main

import (
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"os/user"
	"path/filepath"
	"strings"
	"syscall"

	"esbozo"
	"esbozo/internal/core"
)

// skillArguments is what one `skill` run was asked for: print the skill, or install
// it into a folder.
type skillArguments struct {
	install bool
	dir     string
}

// parseSkillArguments reads no argument, `install`, or `install --dir <path>`, and
// refuses anything else as a usage error. `install` on its own goes to the folder
// this user's agent skills live in; `--dir` names the folder as it was typed, so a
// relative one is read from the folder the command runs in.
func parseSkillArguments(argv []string) (skillArguments, bool) {
	if len(argv) == 0 {
		return skillArguments{}, true
	}
	if argv[0] != "install" {
		return skillArguments{}, false
	}
	if len(argv) == 1 {
		home, err := homeFolder()
		if err != nil {
			return skillArguments{}, false
		}
		return skillArguments{install: true, dir: filepath.Join(home, ".agents", "skills")}, true
	}
	if len(argv) == 3 && argv[1] == "--dir" {
		dir := argv[2]
		if dir == "" || strings.HasPrefix(dir, "--") {
			return skillArguments{}, false
		}
		absolute, err := filepath.Abs(dir)
		if err != nil {
			return skillArguments{}, false
		}
		return skillArguments{install: true, dir: absolute}, true
	}
	return skillArguments{}, false
}

// homeFolder is `homedir()` in `node:os`: `HOME` when the environment has it, and
// the home the user database gives this user when it does not.
func homeFolder() (string, error) {
	if home, err := os.UserHomeDir(); err == nil {
		return home, nil
	}
	who, err := user.Current()
	if err != nil {
		return "", err
	}
	return who.HomeDir, nil
}

// runSkill is `skill`: the shipped SKILL.md to stdout, or a copy of it written to
// `<dir>/esbozo/SKILL.md` with that path printed.
func runSkill(argv []string, stdout, stderr io.Writer) int {
	parsed, ok := parseSkillArguments(argv)
	if !ok {
		fmt.Fprintln(stderr, skillUsageLine)
		return exitUsage
	}
	if !parsed.install {
		_, _ = stdout.Write(esbozo.Skill)
		return exitOK
	}

	target := filepath.Join(parsed.dir, "esbozo", "SKILL.md")
	if err := os.MkdirAll(filepath.Dir(target), 0o777); err != nil {
		fmt.Fprintf(stderr, "cannot write %s: %s\n", target, cannotMkdir(err, filepath.Dir(target)))
		return exitWriteFailed
	}
	// 0666, as `writeFile` writes: the umask decides the rest.
	if err := os.WriteFile(target, esbozo.Skill, 0o666); err != nil {
		fmt.Fprintf(stderr, "cannot write %s: %s\n", target, core.NodeMessage(err, target, false))
		return exitWriteFailed
	}
	fmt.Fprintln(stdout, target)
	return exitOK
}

// cannotMkdir is what Node says about a folder it could not make. Node words every
// file error the same way — `CODE: reason, syscall 'path'` — and tries the folder it
// was given before it climbs to a folder that is missing, so a path that runs into a
// file is named whole, and a folder that is itself a file is `EEXIST`.
func cannotMkdir(err error, dir string) string {
	var pathErr *fs.PathError
	if !errors.As(err, &pathErr) {
		return err.Error()
	}
	if errors.Is(pathErr, syscall.ENOTDIR) {
		if pathErr.Path == dir {
			return fmt.Sprintf("EEXIST: file already exists, mkdir '%s'", dir)
		}
		return fmt.Sprintf("ENOTDIR: not a directory, mkdir '%s'", dir)
	}
	// `NodeMessage` words the error for an `open`, and `mkdir` is the only word
	// that differs.
	return strings.Replace(core.NodeMessage(pathErr.Err, pathErr.Path, false), ", open '", ", mkdir '", 1)
}
