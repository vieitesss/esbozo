//go:build linux

package main

import (
	"os"
	"syscall"
	"unsafe"
)

// isTerminal is Node's `stream.isTTY`, which only the kernel can answer: a
// file's mode cannot, since `/dev/null` is a character device too.
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
