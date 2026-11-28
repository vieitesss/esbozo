package nodeerr

import (
	"os"
	"path/filepath"
	"testing"
)

// scratch is the temporary folder a subtest makes its real files in.
func scratch(t *testing.T) string {
	t.Helper()
	if os.Geteuid() == 0 {
		t.Skip("root reads and writes whatever the mode says, so no ERRNO is reachable")
	}
	return t.TempDir()
}

// readFailure is the error reading path returned, for a path that cannot be read.
func readFailure(t *testing.T, path string) error {
	t.Helper()
	_, err := os.ReadFile(path)
	if err == nil {
		t.Fatalf("reading %s succeeded, so there is no error to word", path)
	}
	return err
}

// writeFailure is the error writing path returned, for a path that cannot be written.
func writeFailure(t *testing.T, path string) error {
	t.Helper()
	err := os.WriteFile(path, []byte("{}"), 0o666)
	if err == nil {
		t.Fatalf("writing %s succeeded, so there is no error to word", path)
	}
	return err
}

// mkdirFailure is the error creating dir returned, for a dir that cannot be made.
func mkdirFailure(t *testing.T, dir string) error {
	t.Helper()
	err := os.MkdirAll(dir, 0o777)
	if err == nil {
		t.Fatalf("creating %s succeeded, so there is no error to word", dir)
	}
	return err
}

// wording is the message a person is shown, beside the one Node shows for it.
func wording(t *testing.T, got, want string) {
	t.Helper()
	if got != want {
		t.Fatalf("wording is\n  %s\nwant\n  %s", got, want)
	}
}

func TestMessageWordsAReadFailure(t *testing.T) {
	folder := scratch(t)

	t.Run("a file that is missing", func(t *testing.T) {
		path := filepath.Join(folder, "missing.json")
		wording(t, Message(readFailure(t, path), path, true),
			"ENOENT: no such file or directory, open '"+path+"'")
	})

	t.Run("a folder read as a file", func(t *testing.T) {
		// The open worked, so Node words the read and leaves the path out.
		wording(t, Message(readFailure(t, folder), folder, true),
			"EISDIR: illegal operation on a directory, read")
	})

	t.Run("a file the person may not read", func(t *testing.T) {
		path := filepath.Join(folder, "private.json")
		if err := os.WriteFile(path, []byte("{}"), 0o000); err != nil {
			t.Fatalf("cannot write %s: %v", path, err)
		}
		wording(t, Message(readFailure(t, path), path, true),
			"EACCES: permission denied, open '"+path+"'")
	})
}

func TestMessageWordsAWriteFailure(t *testing.T) {
	folder := scratch(t)

	t.Run("a folder where the file should go", func(t *testing.T) {
		// os.WriteFile opens first, and the open is what fails.
		wording(t, Message(writeFailure(t, folder), folder, false),
			"EISDIR: illegal operation on a directory, open '"+folder+"'")
	})

	t.Run("a file below a folder that is missing", func(t *testing.T) {
		path := filepath.Join(folder, "no", "such", "scene.json")
		wording(t, Message(writeFailure(t, path), path, false),
			"ENOENT: no such file or directory, open '"+path+"'")
	})
}

func TestMkdirWordsTheFolderItFailsOn(t *testing.T) {
	folder := scratch(t)

	t.Run("a folder the person may not write in", func(t *testing.T) {
		locked := filepath.Join(folder, "locked")
		if err := os.Mkdir(locked, 0o500); err != nil {
			t.Fatalf("cannot make %s: %v", locked, err)
		}
		t.Cleanup(func() { _ = os.Chmod(locked, 0o700) })
		dir := filepath.Join(locked, "skill")
		wording(t, Mkdir(mkdirFailure(t, dir), dir),
			"EACCES: permission denied, mkdir '"+dir+"'")
	})

	t.Run("a file where the folder should go", func(t *testing.T) {
		// os.MkdirAll reports the path is not a folder; the stat says it is taken.
		dir := filepath.Join(folder, "taken")
		if err := os.WriteFile(dir, []byte("{}"), 0o666); err != nil {
			t.Fatalf("cannot write %s: %v", dir, err)
		}
		wording(t, Mkdir(mkdirFailure(t, dir), dir),
			"EEXIST: file already exists, mkdir '"+dir+"'")
	})

	t.Run("a folder below a file", func(t *testing.T) {
		file := filepath.Join(folder, "a-file")
		if err := os.WriteFile(file, []byte("{}"), 0o666); err != nil {
			t.Fatalf("cannot write %s: %v", file, err)
		}
		dir := filepath.Join(file, "skill")
		wording(t, Mkdir(mkdirFailure(t, dir), dir),
			"ENOTDIR: not a directory, mkdir '"+dir+"'")
	})

	t.Run("a link that points at itself", func(t *testing.T) {
		// mkdir fails EEXIST on the link while the stat cannot follow it at all,
		// so the wording has to come from the stat's error.
		dir := filepath.Join(folder, "loop")
		if err := os.Symlink(dir, dir); err != nil {
			t.Skipf("cannot make a symbolic link here: %v", err)
		}
		wording(t, Mkdir(mkdirFailure(t, dir), dir),
			"ELOOP: too many symbolic links encountered, mkdir '"+dir+"'")
	})
}
