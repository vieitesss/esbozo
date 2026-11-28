package main

import (
	"fmt"
	"io"
	"os"
	"os/user"
	"path/filepath"
	"strings"

	"esbozo"
	"esbozo/internal/nodeerr"
)

type skillArguments struct {
	install bool
	dir     string
}

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

func runSkill(argv []string, stdout, stderr io.Writer) int {
	parsed, ok := parseSkillArguments(argv)
	if !ok {
		fmt.Fprintln(stderr, usageLine["skill"])
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
		fmt.Fprintf(stderr, "cannot write %s: %s\n", target, nodeerr.Mkdir(err, filepath.Dir(target)))
		return exitWriteFailed
	}
	if err := os.WriteFile(target, esbozo.Skill, 0o666); err != nil {
		fmt.Fprintf(stderr, "cannot write %s: %s\n", target, nodeerr.Message(err, target, false))
		return exitWriteFailed
	}
	fmt.Fprintln(stdout, target)
	return exitOK
}
