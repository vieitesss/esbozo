package main

import (
	"errors"
	"io/fs"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"syscall"
	"time"
	"unicode/utf8"

	"esbozo/internal/core"
)

const scenesAPI = "/api/scenes"

type listing struct {
	Folder   string   `json:"folder"`
	ReadOnly bool     `json:"readOnly"`
	Scenes   []string `json:"scenes"`
}

type listingCache struct {
	mu      sync.Mutex
	entries map[string]listingEntry
}

type listingEntry struct {
	modified time.Time
	size     int64
	listed   bool
}

func newListingCache() *listingCache {
	return &listingCache{entries: make(map[string]listingEntry)}
}

func (cache *listingCache) answer(path string, file fs.FileInfo) (bool, bool) {
	cache.mu.Lock()
	defer cache.mu.Unlock()
	entry, kept := cache.entries[path]
	if !kept || entry.size != file.Size() || !entry.modified.Equal(file.ModTime()) {
		return false, false
	}
	return entry.listed, true
}

func (cache *listingCache) remember(path string, file fs.FileInfo, listed bool) {
	cache.mu.Lock()
	defer cache.mu.Unlock()
	cache.entries[path] = listingEntry{modified: file.ModTime(), size: file.Size(), listed: listed}
}

func (cache *listingCache) forget(path string) {
	cache.mu.Lock()
	defer cache.mu.Unlock()
	delete(cache.entries, path)
}

func (cache *listingCache) keep(present map[string]bool) {
	cache.mu.Lock()
	defer cache.mu.Unlock()
	for path := range cache.entries {
		if !present[path] {
			delete(cache.entries, path)
		}
	}
}

func serveListing(response http.ResponseWriter, request *http.Request, folder string, readOnly bool, session *core.Session, cache *listingCache) {
	if request.Method != http.MethodGet {
		sendJSON(response, http.StatusMethodNotAllowed, problem{"use GET"})
		return
	}
	scenes, err := listScenes(folder, session, cache)
	if err != nil {
		sendJSON(response, http.StatusInternalServerError, problem{err.Error()})
		return
	}
	sendJSON(response, http.StatusOK, listing{
		Folder:   filepath.Base(folder),
		ReadOnly: readOnly,
		Scenes:   scenes,
	})
}

func listScenes(folder string, session *core.Session, cache *listingCache) ([]string, error) {
	entries, err := os.ReadDir(folder)
	if err != nil {
		return nil, err
	}
	scenes := make([]string, 0, len(entries))
	present := make(map[string]bool, len(entries))
	for _, entry := range entries {
		fileName := entry.Name()
		if !entry.Type().IsRegular() {
			continue
		}
		names, err := session.Names(fileName, "")
		if err != nil {
			return nil, err
		}
		if names.Problem != "" {
			continue
		}
		path := filepath.Join(folder, fileName)
		present[path] = true
		listed, err := listedAsScene(path, names, session, cache)
		if err != nil {
			return nil, err
		}
		if listed {
			scenes = append(scenes, fileName)
		}
	}
	cache.keep(present)
	sort.Slice(scenes, func(left, right int) bool {
		one, other := strings.ToLower(scenes[left]), strings.ToLower(scenes[right])
		if one != other {
			return one < other
		}
		return scenes[left] > scenes[right]
	})
	return scenes, nil
}

// listedAsScene is whether a folder lists one of its regular files: by its name
// alone, or by reading it as a Scene too.
func listedAsScene(path string, names core.SceneNames, session *core.Session, cache *listingCache) (bool, error) {
	switch names.Listed {
	case core.SceneListingAlways:
		return true, nil
	case core.SceneListingIfScene:
		return parsesAsScene(path, names.MaxListedSceneBytes, session, cache)
	}
	return false, nil
}

func parsesAsScene(path string, maxBytes int64, session *core.Session, cache *listingCache) (bool, error) {
	found, err := os.Stat(path)
	if err != nil {
		if cannotList(err) {
			return false, nil
		}
		return false, err
	}
	if found.Size() > maxBytes {
		return false, nil
	}
	if listed, kept := cache.answer(path, found); kept {
		return listed, nil
	}
	source, err := os.ReadFile(path)
	if err != nil {
		if cannotList(err) {
			return false, nil
		}
		return false, err
	}
	parsed, err := session.Parse(source)
	if err != nil {
		return false, err
	}
	cache.remember(path, found, parsed.OK)
	return parsed.OK, nil
}

func cannotList(err error) bool {
	return errors.Is(err, fs.ErrNotExist) ||
		errors.Is(err, fs.ErrPermission) ||
		errors.Is(err, syscall.EPERM) ||
		errors.Is(err, syscall.EISDIR)
}

func serveScene(response http.ResponseWriter, request *http.Request, folder, encodedName string, readOnly bool, session *core.Session, writes *writeQueue, cache *listingCache) {
	name, err := url.PathUnescape(encodedName)
	if err != nil || !utf8.ValidString(name) {
		sendJSON(response, http.StatusBadRequest, problem{"the Scene name is not valid percent-encoding"})
		return
	}
	names, err := session.Names(name, "")
	if err != nil {
		sendJSON(response, http.StatusInternalServerError, problem{err.Error()})
		return
	}
	if names.Problem != "" {
		sendJSON(response, http.StatusBadRequest, problem{names.Problem})
		return
	}

	path := filepath.Join(folder, name)
	if !staysInside(folder, path) {
		sendJSON(response, http.StatusForbidden, problem{name + " leaves the folder"})
		return
	}

	if request.Method == http.MethodPut || request.Method == http.MethodPost {
		serveWrite(response, request, folder, name, names, readOnly, session, writes, cache)
		return
	}
	if request.Method != http.MethodGet {
		sendJSON(response, http.StatusMethodNotAllowed, problem{"use GET, PUT or POST"})
		return
	}
	source, found, err := readScene(path)
	if err != nil {
		sendJSON(response, http.StatusInternalServerError, problem{err.Error()})
		return
	}
	if !found {
		sendJSON(response, http.StatusNotFound, problem{"no Scene named " + name})
		return
	}
	header := response.Header()
	header.Set("content-type", "application/json; charset=utf-8")
	header.Set("cache-control", "no-store")
	response.WriteHeader(http.StatusOK)
	_, _ = response.Write(source)
}

func staysInside(folder, path string) bool {
	resolved, err := filepath.EvalSymlinks(path)
	if err != nil {
		return errors.Is(err, fs.ErrNotExist)
	}
	return strings.HasPrefix(resolved, folder+string(filepath.Separator))
}

func readScene(path string) ([]byte, bool, error) {
	found, err := os.Stat(path)
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return nil, false, nil
		}
		return nil, false, err
	}
	if !found.Mode().IsRegular() {
		return nil, false, nil
	}
	source, err := os.ReadFile(path)
	if err != nil {
		return nil, false, err
	}
	return source, true, nil
}
