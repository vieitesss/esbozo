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

// usageUpdate is the line `ez update` prints for flags it cannot read. It is not
// `usageLine`'s: the TS CLI has no `update`, so no `src/help.ts` words exist to
// hold this to.
const usageUpdate = "usage: ez update [--main | --version <X.Y.Z>]"

// runUpdate is `update`, and `upgrade` as its alias: the carried installer, on
// the folder this binary runs from, with the flags this run was given.
func runUpdate(argv []string, stdout, stderr io.Writer) int {
	tag, ok := updateTag(argv)
	if !ok {
		fmt.Fprintln(stderr, usageUpdate)
		return exitUsage
	}
	folder, err := ezFolder()
	if err != nil {
		fmt.Fprintf(stderr, "ez update: cannot find the folder ez runs from: %s\n", err)
		return exitInstallFailed
	}
	if refused := updateRefusal(tag, folder); refused != "" {
		fmt.Fprint(stderr, refused)
		return exitInstallFailed
	}
	return runInstallScript(tag, folder, stdout, stderr)
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
func updateRefusal(tag string, folder string) string {
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
			folder, tag)
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

// updateTag reads this command's own flags, once, before any refusal is judged:
// the tag they name — the Main build, that Release, or the latest one — which is
// also the `docker pull` tag a refusal in Docker prints. `ok` is false for the
// flags `ez update` does not take — an unknown one, `--dir`, which it sets
// itself, a `--version` with nothing after it or with no `X.Y.Z` in it, and
// `--main` with `--version` — so what reaches the script is always one channel
// it reads the same way.
func updateTag(argv []string) (tag string, ok bool) {
	main, version := false, ""
	for index := 0; index < len(argv); index++ {
		switch argv[index] {
		case "--main":
			main = true
		case "--version":
			if index+1 >= len(argv) || !isVersion(argv[index+1]) {
				return "", false
			}
			version = argv[index+1]
			index++
		default:
			return "", false
		}
	}
	switch {
	case main && version != "":
		return "", false
	case main:
		return "main", true
	case version != "":
		return version, true
	}
	return "latest", true
}

// isVersion reports whether s is the `X.Y.Z` `--version` takes: three parts of
// digits and nothing else, so a tag that is a path — `1.2.3/../main` — is refused
// here rather than fetched as the Release it resolves to.
func isVersion(s string) bool {
	parts := strings.Split(s, ".")
	if len(parts) != 3 {
		return false
	}
	for _, part := range parts {
		if part == "" || strings.Trim(part, "0123456789") != "" {
			return false
		}
	}
	return true
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
// stdin, with the tag this run was given and `--dir` last, so the folder this
// binary runs from is where it installs whatever a `--dir` of the caller's would
// have asked for. The environment is inherited — `ESBOZO_RELEASE_URL` reaches the
// script that way — and the two streams and the exit code are the script's own.
func runInstallScript(tag string, folder string, stdout, stderr io.Writer) int {
	args := []string{"-s", "--"}
	if tag == "main" {
		args = append(args, "--main")
	} else if tag != "latest" {
		args = append(args, "--version", tag)
	}
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
