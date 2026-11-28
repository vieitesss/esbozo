// Package nodeerr words an I/O failure the way a Node user hears it.
package nodeerr

import (
	"errors"
	"fmt"
	"io/fs"
	"os"
	"syscall"
)

// Message words err for a path `ez` opened, in Node's fs error wording
// (e.g. "ENOENT: no such file or directory, open 'path'").
// When reading is true, EISDIR formats as a read error.
func Message(err error, path string, reading bool) string {
	if reading && errors.Is(err, syscall.EISDIR) {
		return "EISDIR: illegal operation on a directory, read"
	}
	return message(err, path, "open")
}

// Mkdir words an os.MkdirAll error in Node's fs.mkdir wording.
func Mkdir(err error, dir string) string {
	var pathErr *fs.PathError
	if !errors.As(err, &pathErr) {
		return err.Error()
	}
	taken := errors.Is(pathErr.Err, fs.ErrExist) ||
		(errors.Is(pathErr.Err, syscall.ENOTDIR) && pathErr.Path == dir)
	if !taken {
		if errors.Is(pathErr.Err, syscall.ENOTDIR) {
			return message(pathErr.Err, dir, "mkdir")
		}
		return message(pathErr.Err, pathErr.Path, "mkdir")
	}
	// Node probes dir before climbing, whereas os.MkdirAll reports the failing
	// ancestor; stat dir to match Node's error code and path.
	info, statErr := os.Stat(dir)
	switch {
	case statErr != nil && !errors.Is(statErr, fs.ErrNotExist):
		return message(statErr, dir, "mkdir")
	case info != nil:
		return message(syscall.EEXIST, dir, "mkdir")
	case pathErr.Path == dir:
		return message(statErr, dir, "mkdir")
	}
	return message(syscall.ENOTDIR, pathErr.Path, "mkdir")
}

func message(err error, path, call string) string {
	switch {
	case errors.Is(err, fs.ErrNotExist):
		return fmt.Sprintf("ENOENT: no such file or directory, %s '%s'", call, path)
	case errors.Is(err, fs.ErrPermission):
		return fmt.Sprintf("EACCES: permission denied, %s '%s'", call, path)
	case errors.Is(err, syscall.EEXIST):
		return fmt.Sprintf("EEXIST: file already exists, %s '%s'", call, path)
	case errors.Is(err, syscall.ELOOP):
		return fmt.Sprintf("ELOOP: too many symbolic links encountered, %s '%s'", call, path)
	case errors.Is(err, syscall.EISDIR):
		return fmt.Sprintf("EISDIR: illegal operation on a directory, %s '%s'", call, path)
	case errors.Is(err, syscall.ENOTDIR):
		return fmt.Sprintf("ENOTDIR: not a directory, %s '%s'", call, path)
	}
	return err.Error()
}
