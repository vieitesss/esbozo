//go:build linux

package main

import (
	"os"
	"syscall"
	"unsafe"
)

// isTerminal is `isatty`: Node's `stream.isTTY`, which only the operating system
// can answer. A file's mode says nothing about it — `/dev/null` and `/dev/zero`
// are character devices too — so this asks the kernel for the terminal's
// settings, which it hands over for a terminal and for nothing else.
func isTerminal(file *os.File) bool {
	var settings syscall.Termios
	_, _, failure := syscall.Syscall6(
		syscall.SYS_IOCTL,
		file.Fd(),
		syscall.TCGETS,
		uintptr(unsafe.Pointer(&settings)),
		0, 0, 0,
	)
	return failure == 0
}
