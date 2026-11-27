//go:build !linux && !darwin

package main

import "os"

// isTerminal answers false: this platform's terminal settings are not asked for
// yet, so its help is the plain text Node prints to a pipe.
func isTerminal(file *os.File) bool {
	return false
}
