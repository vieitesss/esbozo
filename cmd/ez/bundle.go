package main

import (
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"esbozo"
	"esbozo/internal/nodeerr"
)

func runBundle(argv []string, stdout, stderr io.Writer) int {
	folder := ""
	if len(argv) == 1 {
		folder = argv[0]
	}
	if folder == "" || strings.HasPrefix(folder, "--") {
		fmt.Fprintln(stderr, usageLine["bundle"])
		return exitUsage
	}

	outputPath, err := bundlePath(folder)
	if err != nil {
		fmt.Fprintf(stderr, "cannot name the bundle in %s: %s\n", folder, err)
		return exitWriteFailed
	}
	if err := os.WriteFile(outputPath, esbozo.EmbedBundle, 0o666); err != nil {
		fmt.Fprintf(stderr, "cannot write %s: %s\n", outputPath, nodeerr.Message(err, outputPath, false))
		return exitWriteFailed
	}
	fmt.Fprintln(stdout, outputPath)
	return exitOK
}

func bundlePath(folder string) (string, error) {
	resolved, err := filepath.Abs(folder)
	if err != nil {
		return "", err
	}
	return filepath.Join(resolved, "esbozo-"+esbozo.Version+".js"), nil
}
