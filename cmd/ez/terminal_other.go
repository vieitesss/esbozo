//go:build !linux && !darwin

package main

import "os"

// isTerminal answers false on a platform whose terminal settings are not asked
// for yet: the help is then the plain text Node prints to a pipe, which is what
// every command that is not a terminal gets anyway.
func isTerminal(file *os.File) bool {
	return false
}
