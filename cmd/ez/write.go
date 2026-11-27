// The Scene API's write: `PUT` and `POST /api/scenes/<name>`, as
// `docs/save-api.md` states it. The checks run in the order that
// file gives them, and the pair is written the way its "Writes are serialised
// and undone on failure" says: one queue per output pair, the old Scene copied
// aside, and both files put back when either rename fails.
package main

import (
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"esbozo/internal/core"
)

// bodyLimit: a write larger than a Scene
// anyone draws is refused before it is read into memory.
const bodyLimit = 8 * 1024 * 1024

// sceneWrite is `SceneWrite` in `src/scenes-api.ts`: the two texts a write
// carries, the Scene to store and the SVG drawn beside it.
type sceneWrite struct {
	Scene string
	Svg   string
}

// writeRefused: a write the server refuses
// to finish, with the status its answer carries.
type writeRefused struct {
	status  int
	message string
}

func (refusal writeRefused) Error() string { return refusal.message }

// serveWrite takes one write, in the order `docs/save-api.md` gives the checks:
// the folder's mode, then how the body announces itself, then its size, its form
// and the Scene inside it, and only then the folder's files.
func serveWrite(response http.ResponseWriter, request *http.Request, folder, name string, readOnly bool, session *core.Session, writes *writeQueue, cache *listingCache) {
	if readOnly {
		sendJSON(response, http.StatusForbidden, problem{"this folder is served read-only"})
		return
	}
	if !announcesJSON(request) {
		sendJSON(response, http.StatusUnsupportedMediaType, problem{"send the write as content-type: application/json"})
		return
	}
	body, err := readBody(request)
	if errors.Is(err, errBodyTooLarge) {
		sendJSON(response, http.StatusRequestEntityTooLarge, problem{fmt.Sprintf("the body is over %d bytes", bodyLimit)})
		return
	}
	if err != nil {
		sendJSON(response, http.StatusInternalServerError, problem{err.Error()})
		return
	}
	written, isWrite := parseSceneWrite(body)
	if !isWrite {
		sendJSON(response, http.StatusBadRequest, problem{`the body must be { "scene": "<text>", "svg": "<text>" }`})
		return
	}

	// The Scene goes through the parser `ez check` uses, so the server never
	// stores what `ez check` would refuse. Nothing is written before it passes.
	parsed, err := session.Parse([]byte(written.Scene))
	if err != nil {
		sendJSON(response, http.StatusInternalServerError, problem{err.Error()})
		return
	}
	if !parsed.OK {
		sendJSON(response, http.StatusBadRequest, problem{"the Scene is invalid: " + strings.Join(parsed.Problems, "; ")})
		return
	}

	scenePath := filepath.Join(folder, name)
	svgPath := filepath.Join(folder, svgFileName(name))
	// The queue is the SVG's name, case-folded: `flow.esbozo` and `flow.json`
	// both replace `flow.svg`, and on a case-insensitive disk so do `alias.json`
	// and `alias.JSON`, so a name and its SVG share one queue.
	err = writes.run(queueKey(name), func() error {
		return writePair(scenePath, svgPath, written)
	})
	// Whatever the write left on disk, the answer the listing kept about this name
	// was made from the file it replaced.
	cache.forget(scenePath)
	if err != nil {
		var refusal writeRefused
		if errors.As(err, &refusal) {
			sendJSON(response, refusal.status, problem{refusal.message})
			return
		}
		sendJSON(response, http.StatusInternalServerError, problem{err.Error()})
		return
	}
	sendJSON(response, http.StatusOK, struct{}{})
}

// announcesJSON: the body has to say it is
// JSON, because a cross-origin page can post `text/plain` without asking first
// and this rule is what stops it writing to the folder.
func announcesJSON(request *http.Request) bool {
	mediaType, _, _ := strings.Cut(request.Header.Get("content-type"), ";")
	return strings.EqualFold(strings.TrimSpace(mediaType), "application/json")
}

// errBodyTooLarge is the one read failure the route answers itself: the body is
// over bodyLimit, and nothing has been written.
var errBodyTooLarge = errors.New("the body is over the limit")

// readBody: the request's bytes, or
// errBodyTooLarge once it passes the limit — read one byte past it, so a body
// the size of the limit itself is taken.
func readBody(request *http.Request) ([]byte, error) {
	body, err := io.ReadAll(io.LimitReader(request.Body, bodyLimit+1))
	if err != nil {
		return nil, err
	}
	if len(body) > bodyLimit {
		return nil, errBodyTooLarge
	}
	return body, nil
}

// parseSceneWrite reads a write body: the two texts `SceneWrite` in
// `src/scenes-api.ts` describes, the Scene to store and the SVG drawn beside it.
// A body that is not the JSON object above is no write. The keys are read
// exactly as written — `{"Scene": …}` is no write, as the property read in TS
// makes it — and a field that is not a string is no write either.
func parseSceneWrite(body []byte) (sceneWrite, bool) {
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(body, &fields); err != nil {
		return sceneWrite{}, false
	}
	scene, hasScene := jsonString(fields, "scene")
	svg, hasSvg := jsonString(fields, "svg")
	if !hasScene || !hasSvg {
		return sceneWrite{}, false
	}
	return sceneWrite{Scene: scene, Svg: svg}, true
}

// jsonString is one field of a write body, when it is there and is a string. A
// field that is JSON `null` is no string, though Go would unmarshal it into one
// as its zero value.
func jsonString(fields map[string]json.RawMessage, name string) (string, bool) {
	written, present := fields[name]
	if !present {
		return "", false
	}
	var text *string
	if err := json.Unmarshal(written, &text); err != nil || text == nil {
		return "", false
	}
	return *text, true
}

// svgFileName is `svgFileName` in `src/paths.ts`: the SVG of a Scene is its
// stem and `.svg`, so `a.esbozo` and `a.json` both reach `a.svg`.
func svgFileName(name string) string {
	return sceneStem(name) + ".svg"
}

// queueKey is the write queue a Scene name takes: its SVG, case-folded, so two
// names that replace one file wait on each other however they are spelled.
func queueKey(name string) string {
	return strings.ToLower(svgFileName(name))
}

// writeQueue: one queue per output pair, so
// two writes to one Scene never interleave. Writes whose Scenes reach different
// SVGs run at the same time, and a read never waits for a write.
type writeQueue struct {
	mu     sync.Mutex
	queues map[string]*queuedWrite
}

// queuedWrite is one output pair's queue: the lock a write holds while it lands
// and the number of writes that have reached it, so the queue goes when the last
// of them has.
type queuedWrite struct {
	lock    sync.Mutex
	waiting int
}

// newWriteQueue is the queues of one `ez serve` run: they hold no folder and no
// bytes, only which writes are waiting on which pair.
func newWriteQueue() *writeQueue {
	return &writeQueue{queues: map[string]*queuedWrite{}}
}

// run is one write behind every write of the same key, and the write's own
// answer. The queue for a key is dropped once no write holds or waits on it, so
// a server that has written a thousand Scenes carries a thousand fewer queues.
func (queue *writeQueue) run(key string, job func() error) error {
	queue.mu.Lock()
	held, queued := queue.queues[key]
	if !queued {
		held = &queuedWrite{}
		queue.queues[key] = held
	}
	held.waiting++
	queue.mu.Unlock()

	held.lock.Lock()
	err := job()
	held.lock.Unlock()

	queue.mu.Lock()
	held.waiting--
	if held.waiting == 0 {
		delete(queue.queues, key)
	}
	queue.mu.Unlock()
	return err
}

// writePair: both targets checked, the old
// Scene copied aside, both texts written to temporary files, then the Scene
// renamed into place and then the SVG. A failure anywhere puts the old Scene
// back and leaves the old SVG untouched, so the SVG never leads the Scene.
func writePair(scenePath, svgPath string, written sceneWrite) error {
	if err := refuseNonFile(scenePath); err != nil {
		return err
	}
	if err := refuseNonFile(svgPath); err != nil {
		return err
	}

	backup, err := aside(scenePath, "bak")
	if err != nil {
		return err
	}
	hadScene, err := copyAside(scenePath, backup)
	if err != nil {
		return err
	}
	sceneTemporary, err := aside(scenePath, "tmp")
	if err != nil {
		return err
	}
	svgTemporary, err := aside(svgPath, "tmp")
	if err != nil {
		return err
	}

	// keepBackup is the undo that could not run: the copy is then the only place
	// the old Scene still is, so it stays and the answer names it.
	keepBackup := false
	defer func() {
		_ = os.Remove(sceneTemporary)
		_ = os.Remove(svgTemporary)
		if !keepBackup {
			_ = os.Remove(backup)
		}
	}()

	// 0666, as `writeFile` writes: the umask decides the rest.
	err = os.WriteFile(sceneTemporary, []byte(written.Scene), 0o666)
	if err == nil {
		err = os.WriteFile(svgTemporary, []byte(written.Svg), 0o666)
	}
	if err == nil {
		err = os.Rename(sceneTemporary, scenePath)
	}
	if err == nil {
		err = os.Rename(svgTemporary, svgPath)
	}
	if err != nil {
		unput := putBack(scenePath, backup, hadScene)
		keepBackup = unput != nil
		if unput != nil {
			return unput
		}
		return err
	}
	return nil
}

// refuseNonFile: a target that exists and
// is not a regular file is refused before anything is written, because a folder
// or a pipe renamed over would take the write nowhere.
func refuseNonFile(target string) error {
	found, err := os.Stat(target)
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return nil
		}
		return err
	}
	if found.IsDir() {
		return writeRefused{
			status:  http.StatusConflict,
			message: filepath.Base(target) + " is a folder: save the Scene under another name",
		}
	}
	if !found.Mode().IsRegular() {
		return writeRefused{
			status:  http.StatusConflict,
			message: filepath.Base(target) + " is not a file: save the Scene under another name",
		}
	}
	return nil
}

// copyAside: the Scene as it is now, beside
// itself, so a failed write has something to put back. A Scene that is not
// there yet has nothing to copy, which is not a failure.
func copyAside(target, backup string) (bool, error) {
	found, err := os.Stat(target)
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return false, nil
		}
		return false, err
	}
	source, err := os.ReadFile(target)
	if err != nil {
		return false, err
	}
	if err := os.WriteFile(backup, source, found.Mode().Perm()); err != nil {
		return false, err
	}
	return true, nil
}

// putBack: the old Scene back where the write
// renamed over it, or the failed Scene taken away when there was no old one. An
// undo that cannot land is a refusal that names the copy, because a Scene this
// server could not keep is never lost quietly.
func putBack(scenePath, backup string, hadScene bool) error {
	var failed error
	if hadScene {
		failed = os.Rename(backup, scenePath)
	} else {
		failed = os.Remove(scenePath)
		if errors.Is(failed, fs.ErrNotExist) {
			failed = nil
		}
	}
	if failed == nil {
		return nil
	}
	return writeRefused{
		status: http.StatusInternalServerError,
		message: fmt.Sprintf("%s could not be put back after a failed write: the Scene from before it is at %s (%s)",
			filepath.Base(scenePath), backup, failed),
	}
}

// aside is the name of a file a write makes beside its target: `<target>.<uuid>.
// <suffix>` for the copy it takes aside and the two files it lands from, so no
// two writes can reach one of them.
func aside(target, suffix string) (string, error) {
	identifier, err := newUUID()
	if err != nil {
		return "", err
	}
	return target + "." + identifier + "." + suffix, nil
}

// newUUID: sixteen random bytes in the
// 8-4-4-4-12 form of RFC 4122 version 4.
func newUUID() (string, error) {
	var bytes [16]byte
	if _, err := rand.Read(bytes[:]); err != nil {
		return "", err
	}
	bytes[6] = bytes[6]&0x0f | 0x40
	bytes[8] = bytes[8]&0x3f | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", bytes[0:4], bytes[4:6], bytes[6:8], bytes[8:10], bytes[10:16]), nil
}
