//go:build !linux && !darwin

package main

import "os"

func isTerminal(file *os.File) bool {
	return false
}
