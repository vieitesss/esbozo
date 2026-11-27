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
// it into a folder. An empty dir is the folder this user's agent skills live in.
type skillArguments struct {
	install bool
	dir     string
}

// parseSkillArguments reads no argument, `install`, or `install --dir <path>`, and
// refuses anything else as a usage error. `--dir` names the folder as it was typed:
// where that lands is `skillTarget`'s to say, because a folder that cannot be
// resolved is a write that failed, not an argument that is wrong.
func parseSkillArguments(argv []string) (skillArguments, bool) {
	if len(argv) == 0 {
		return skillArguments{}, true
	}
	if argv[0] != "install" {
		return skillArguments{}, false
	}
	if len(argv) == 1 {
		return skillArguments{install: true}, true
	}
	if len(argv) == 3 && argv[1] == "--dir" {
		dir := argv[2]
		if dir == "" || strings.HasPrefix(dir, "--") {
			return skillArguments{}, false
		}
		return skillArguments{install: true, dir: dir}, true
	}
	return skillArguments{}, false
}

// skillTarget is `<dir>/esbozo/SKILL.md` with the folder resolved, so a relative
// folder is read from the folder the command runs in. It is the path a failure
// names, so a folder that cannot be resolved is reported as the file it was meant
// to become, named as far as the folder was known.
func skillTarget(arguments skillArguments) (string, error) {
	folder := arguments.dir
	if folder == "" {
		home, err := homeFolder()
		if err != nil {
			return filepath.Join("esbozo", "SKILL.md"), err
		}
		folder = filepath.Join(home, ".agents", "skills")
	}
	resolved, err := filepath.Abs(folder)
	if err != nil {
		return filepath.Join(folder, "esbozo", "SKILL.md"), err
	}
	return filepath.Join(resolved, "esbozo", "SKILL.md"), nil
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

	target, err := skillTarget(parsed)
	if err != nil {
		fmt.Fprintf(stderr, "cannot write %s: %s\n", target, err)
		return exitWriteFailed
	}
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
