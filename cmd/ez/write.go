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

const bodyLimit = 8 * 1024 * 1024

type sceneWrite struct {
	Scene string
	Svg   string
}

type writeRefused struct {
	status  int
	message string
}

func (refusal writeRefused) Error() string { return refusal.message }

func serveWrite(response http.ResponseWriter, request *http.Request, folder, name string, names core.SceneNames, readOnly bool, session *core.Session, writes *writeQueue, cache *listingCache) {
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
	svgPath := filepath.Join(folder, names.SVG)
	err = writes.run(strings.ToLower(names.SVG), func() error {
		return writePair(scenePath, svgPath, written)
	})
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

var errBodyTooLarge = errors.New("the body is over the limit")

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

type writeQueue struct {
	mu     sync.Mutex
	queues map[string]*queuedWrite
}

type queuedWrite struct {
	lock    sync.Mutex
	waiting int
}

func newWriteQueue() *writeQueue {
	return &writeQueue{queues: map[string]*queuedWrite{}}
}

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

	keepBackup := false
	defer func() {
		_ = os.Remove(sceneTemporary)
		_ = os.Remove(svgTemporary)
		if !keepBackup {
			_ = os.Remove(backup)
		}
	}()

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

func aside(target, suffix string) (string, error) {
	identifier, err := newUUID()
	if err != nil {
		return "", err
	}
	return target + "." + identifier + "." + suffix, nil
}

func newUUID() (string, error) {
	var bytes [16]byte
	if _, err := rand.Read(bytes[:]); err != nil {
		return "", err
	}
	bytes[6] = bytes[6]&0x0f | 0x40
	bytes[8] = bytes[8]&0x3f | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", bytes[0:4], bytes[4:6], bytes[6:8], bytes[8:10], bytes[10:16]), nil
}
