// `update`: the install script this binary carries, re-run against the folder it
// runs from. Go owns where that folder is and why an update is refused here; what
// a Release is, whether it is already on the target and what the flags mean are
// `scripts/install.sh`'s, whose streams and exit code pass straight through
// unchanged.
package main

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"esbozo"
)

// runUpdate is `update`, and `upgrade` as its alias: the carried installer, on
// the folder this binary runs from, with the flags this run was given.
func runUpdate(argv []string, stdout, stderr io.Writer) int {
	folder, err := ezFolder()
	if err != nil {
		fmt.Fprintf(stderr, "ez update: cannot find the folder ez runs from: %s\n", err)
		return exitInstallFailed
	}
	if refused := updateRefusal(argv, folder); refused != "" {
		fmt.Fprint(stderr, refused)
		return exitInstallFailed
	}
	return runInstallScript(argv, folder, stdout, stderr)
}

// ezFolder is the folder the running binary sits in, symlinks resolved: the
// installer links `esbozo` beside `ez`, and a run through that link still updates
// the folder `ez` is in.
func ezFolder() (string, error) {
	executable, err := os.Executable()
	if err != nil {
		return "", err
	}
	resolved, err := filepath.EvalSymlinks(executable)
	if err != nil {
		return "", err
	}
	return filepath.Dir(resolved), nil
}

// updateRefusal is what to print instead of updating this folder, and why: a
// clone is rebuilt, an image is pulled, and a folder nothing may write to takes
// the installer with a `--dir` of its own. An empty answer is no refusal.
func updateRefusal(argv []string, folder string) string {
	if isClone(folder) {
		return fmt.Sprintf(
			"ez update: %s is built in a clone of esbozo, so an update would replace a build\n"+
				"  run `git pull && pnpm build` there instead, which writes %s\n",
			folder, filepath.Join(folder, "ez"))
	}
	if inDocker() {
		return fmt.Sprintf(
			"ez update: this ez runs in a Docker image, where writing %s would change this container only\n"+
				"  docker pull ghcr.io/vieitesss/esbozo:%s\n",
			folder, updateTag(argv))
	}
	if !writableFolder(folder) {
		return fmt.Sprintf(
			"ez update: cannot write to %s\n"+
				"  install ez into a folder of your own instead:\n"+
				"  curl -fsSL https://esbozo.vieitesss.eu/install | sh -s -- --dir \"$HOME/.local/bin\"\n",
			folder)
	}
	return ""
}

// isClone reports whether folder is the `dist/` of a checkout: the repository's
// `go.mod` sits beside it. A release lands in a folder of its own with no module
// beside it, so anything else that happens to hold Go files is not called one.
func isClone(folder string) bool {
	module, err := os.ReadFile(filepath.Join(filepath.Dir(folder), "go.mod"))
	if err != nil {
		return false
	}
	for line := range strings.SplitSeq(string(module), "\n") {
		if strings.TrimSpace(line) == "module esbozo" {
			return true
		}
	}
	return false
}

// inDocker is the image saying so, through the `ESBOZO_DOCKER` its Dockerfile
// sets. `/.dockerenv` is not read: it also names every container a person
// develops in, where the `dist/ez` beside `pnpm` is the clone this file already
// refuses, and a container running the installed binary has already been told
// about itself by the image.
func inDocker() bool {
	return os.Getenv("ESBOZO_DOCKER") != ""
}

// updateTag is the tag the flags name — the Main build, that Release, or the
// latest one — so the line printed is the pull that would replace this image.
func updateTag(argv []string) string {
	tag := "latest"
	for index := 0; index < len(argv); index++ {
		switch argv[index] {
		case "--main":
			tag = "main"
		case "--version":
			if index+1 < len(argv) {
				tag = argv[index+1]
				index++
			}
		}
	}
	return tag
}

// writableFolder writes a probe into folder and takes it away again, because only
// a write answers the question: permissions, an owner and a read-only mount are
// three different reasons a folder says no.
func writableFolder(folder string) bool {
	probe, err := os.CreateTemp(folder, ".ez-update-*")
	if err != nil {
		return false
	}
	name := probe.Name()
	probe.Close()
	os.Remove(name)
	return true
}

// runInstallScript runs the carried `scripts/install.sh` as `sh` reads it from
// stdin, with the flags this run was given and `--dir` last, so the folder this
// binary runs from is where it installs whatever a `--dir` of the caller's would
// have asked for. The environment is inherited — `ESBOZO_RELEASE_URL` reaches the
// script that way — and the two streams and the exit code are the script's own.
func runInstallScript(argv []string, folder string, stdout, stderr io.Writer) int {
	args := append([]string{"-s", "--"}, argv...)
	args = append(args, "--dir", folder)
	command := exec.Command("sh", args...)
	command.Stdin = bytes.NewReader(esbozo.InstallScript)
	command.Stdout = stdout
	command.Stderr = stderr

	err := command.Run()
	if err == nil {
		return exitOK
	}
	var exited *exec.ExitError
	if errors.As(err, &exited) && exited.ExitCode() > 0 {
		return exited.ExitCode()
	}
	fmt.Fprintf(stderr, "ez update: cannot run sh: %s\n", err)
	return exitInstallFailed
}
