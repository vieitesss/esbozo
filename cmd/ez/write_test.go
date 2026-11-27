package main

import (
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"testing"
)

// TestPutBackRestoresTheSceneByteForByte: the write's rename landed and the
// write then failed, so the copy taken aside has to be the file on disk again —
// the bytes a person had are back, and nothing of the copy is left behind.
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

// TestPutBackRemovesASceneTheWriteCreated: a write that made a Scene where there
// was none leaves nothing of it behind when it fails.
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

	// Nothing to take away is the undo done, not a failure: the write failed
	// before it made anything.
	if err := putBack(scene, scene+".kept.bak", false); err != nil {
		t.Errorf("putting back a Scene that was never written failed: %v", err)
	}
}

// TestAFailedRestoreNamesTheCopyThatHoldsTheScene: a folder that will not take
// the Scene back either is the one answer a client can do anything with, so it
// says so and says where the bytes still are.
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
	// The copy is the Scene now: whatever happened, it is never lost quietly.
	if still := readText(t, backup); still != kept {
		t.Errorf("the copy holds %q, not the Scene from before the write", still)
	}
}

// TestNamesThatReachOneSVGShareOneQueue: two names whose Scenes sit beside one
// SVG take the same write queue, or the SVG would be two requests' at once.
func TestNamesThatReachOneSVGShareOneQueue(t *testing.T) {
	for _, names := range [][2]string{
		{"flow.esbozo", "flow.json"},
		{"alias.json", "alias.JSON"},
		// One file on a case-insensitive disk, so one `a.svg` beside it.
		{"a.esbozo", "A.ESBOZO"},
	} {
		if queueKey(names[0]) != queueKey(names[1]) {
			t.Errorf("%s and %s reach one SVG but queue apart: %s, %s",
				names[0], names[1], queueKey(names[0]), queueKey(names[1]))
		}
	}
	if queueKey("one.json") == queueKey("two.json") {
		t.Errorf("two Scenes with an SVG of their own share one queue, so their writes wait on each other")
	}
}

// TestWritesToOneSceneDoNotInterleave: a Scene and its SVG are one answer, so
// writes to one pair land whole, one after the other — the pair on disk always
// comes from a single request.
func TestWritesToOneSceneDoNotInterleave(t *testing.T) {
	folder := t.TempDir()
	scene := filepath.Join(folder, "busy.json")
	svg := filepath.Join(folder, "busy.svg")
	writeText(t, scene, "nothing")
	writeText(t, svg, "nothing")
	queue := newWriteQueue()

	const writes = 32
	answers := make([]error, writes)
	var group sync.WaitGroup
	for index := range writes {
		group.Add(1)
		go func() {
			defer group.Done()
			number := strconv.Itoa(index)
			answers[index] = queue.run(queueKey("busy.json"), func() error {
				return writePair(scene, svg, sceneWrite{
					Scene: "the Scene of write " + number,
					Svg:   "the SVG of write " + number,
				})
			})
		}()
	}
	group.Wait()

	for index, err := range answers {
		if err != nil {
			t.Fatalf("write %d was not answered: %v", index, err)
		}
	}
	saved, drawn := readText(t, scene), readText(t, svg)
	if strings.TrimPrefix(saved, "the Scene of write ") != strings.TrimPrefix(drawn, "the SVG of write ") {
		t.Errorf("the pair on disk is two requests' — %q beside %q", saved, drawn)
	}
	left, err := os.ReadDir(folder)
	if err != nil {
		t.Fatal(err)
	}
	if len(left) != 2 {
		t.Errorf("a write left something beside the pair: %v", namesOf(left))
	}
}

// writeText is a file the test put there, across folders the test made.
func writeText(t *testing.T, path, text string) {
	t.Helper()
	if err := os.WriteFile(path, []byte(text), 0o644); err != nil {
		t.Fatal(err)
	}
}

// readText is a file's bytes, as the write left them.
func readText(t *testing.T, path string) string {
	t.Helper()
	bytes, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return string(bytes)
}

// namesOf is the folder's entries, for a failure that says what is there.
func namesOf(entries []os.DirEntry) []string {
	names := make([]string, 0, len(entries))
	for _, entry := range entries {
		names = append(names, entry.Name())
	}
	return names
}
