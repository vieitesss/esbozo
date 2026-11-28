package main

import (
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"esbozo/internal/core"
)

func TestPutBackRestoresTheSceneByteForByte(t *testing.T) {
	folder := t.TempDir()
	scene := filepath.Join(folder, "kept.json")
	backup := scene + ".kept.bak"
	kept := "{\n  \"version\": 1,\n  \"title\": \"Kept ✓ 世界\",\n  \"elements\": []\n}\n"
	writeText(t, scene, "the write that landed before it failed")
	writeText(t, backup, kept)

	if err := putBack(scene, backup, true); err != nil {
		t.Fatalf("putting the Scene back failed: %v", err)
	}
	if restored := readText(t, scene); restored != kept {
		t.Errorf("the Scene on disk is %q, not the bytes from before the write", restored)
	}
	if _, err := os.Stat(backup); !errors.Is(err, os.ErrNotExist) {
		t.Errorf("%s is still there, so the undo left a file behind", backup)
	}
}

func TestPutBackRemovesASceneTheWriteCreated(t *testing.T) {
	folder := t.TempDir()
	scene := filepath.Join(folder, "made.json")
	writeText(t, scene, "the write that failed after it landed")

	if err := putBack(scene, scene+".kept.bak", false); err != nil {
		t.Fatalf("taking the failed Scene away left %v", err)
	}
	if _, err := os.Stat(scene); !errors.Is(err, os.ErrNotExist) {
		t.Errorf("%s is still there, so a failed write kept a Scene nobody asked for", scene)
	}

	if err := putBack(scene, scene+".kept.bak", false); err != nil {
		t.Errorf("putting back a Scene that was never written failed: %v", err)
	}
}

func TestAFailedRestoreNamesTheCopyThatHoldsTheScene(t *testing.T) {
	folder := t.TempDir()
	if os.Geteuid() == 0 {
		t.Skip("a folder's permission bits stop nobody as root")
	}
	scene := filepath.Join(folder, "kept.json")
	backup := scene + ".kept.bak"
	kept := "{ \"version\": 1, \"elements\": [] }"
	writeText(t, scene, "the write that landed before it failed")
	writeText(t, backup, kept)
	if err := os.Chmod(folder, 0o555); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chmod(folder, 0o755) })

	err := putBack(scene, backup, true)

	var refusal writeRefused
	if !errors.As(err, &refusal) {
		t.Fatalf("a restore that could not land answered %v, not a refusal", err)
	}
	if refusal.status != http.StatusInternalServerError {
		t.Errorf("the refusal carries %d, not 500", refusal.status)
	}
	if !strings.Contains(refusal.message, "could not be put back") {
		t.Errorf("the answer does not say the Scene could not be put back: %s", refusal.message)
	}
	if !strings.Contains(refusal.message, backup) {
		t.Errorf("the answer does not name the copy at %s: %s", backup, refusal.message)
	}
	if still := readText(t, backup); still != kept {
		t.Errorf("the copy holds %q, not the Scene from before the write", still)
	}
}

func TestNamesThatReachOneSVGShareOneQueue(t *testing.T) {
	for _, names := range [][2]string{
		{"flow.esbozo", "flow.json"},
		{"alias.json", "alias.JSON"},
		{"a.esbozo", "A.ESBOZO"},
	} {
		if queueKey(t, names[0]) != queueKey(t, names[1]) {
			t.Errorf("%s and %s reach one SVG but queue apart: %s, %s",
				names[0], names[1], queueKey(t, names[0]), queueKey(t, names[1]))
		}
	}
	if queueKey(t, "one.json") == queueKey(t, "two.json") {
		t.Errorf("two Scenes with an SVG of their own share one queue, so their writes wait on each other")
	}
}

// queueKey is the key a write of this Scene waits on: the production name for
// the Scene's SVG, folded by the production key, so a change there reaches
// this test.
func queueKey(t *testing.T, name string) string {
	t.Helper()
	session, err := core.Open()
	if err != nil {
		t.Fatal(err)
	}
	names, err := session.Names(name, "")
	if err != nil {
		t.Fatalf("naming %s: %v", name, err)
	}
	return writeQueueKey(names.SVG)
}

func writeText(t *testing.T, path, text string) {
	t.Helper()
	if err := os.WriteFile(path, []byte(text), 0o644); err != nil {
		t.Fatal(err)
	}
}

func readText(t *testing.T, path string) string {
	t.Helper()
	bytes, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return string(bytes)
}
