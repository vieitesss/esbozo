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

func runUpdate(argv []string, stdout, stderr io.Writer) int {
	tag, ok := updateTag(argv)
	if !ok {
		fmt.Fprintln(stderr, usageLine["update"])
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

func isClone(folder string) bool {
	if filepath.Base(folder) != "dist" {
		return false
	}
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

func inDocker() bool {
	return os.Getenv("ESBOZO_DOCKER") != ""
}

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
