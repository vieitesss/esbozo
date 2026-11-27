// The Scene API's two reading routes: the list of Scenes one folder offers, and
// one Scene's own bytes, as `docs/save-api.md`
// states them. The write the same route takes is `write.go`'s.
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

// scenesAPI: where the Scene routes start.
const scenesAPI = "/api/scenes"

// maxListedSceneBytes is `MAX_LISTED_SCENE_BYTES` in `src/paths.ts`: a `.json`
// over it is left out of the listing unread.
const maxListedSceneBytes = 5 * 1024 * 1024

// listing is `GET /api/scenes`'s answer: the folder's own name, not its path,
// whether a save would be taken, and the names a request can open.
type listing struct {
	Folder   string   `json:"folder"`
	ReadOnly bool     `json:"readOnly"`
	Scenes   []string `json:"scenes"`
}

// listingCache is what the listing already answered about a file, so a folder
// listed again does not read and parse every Scene again. `ez serve` keeps one for
// the life of the server, and what it holds is a verdict about one file together
// with the file it was made from: an answer is used only while that file's size
// and modification time both still say it is the same file, so every write that
// touched the file since is read again. Its lock is its own, taken for a map and
// never held while a file is read or a Scene parsed.
type listingCache struct {
	mu      sync.Mutex
	entries map[string]listingEntry
}

// listingEntry is one file's verdict and the file it was made from.
type listingEntry struct {
	modified time.Time
	size     int64
	listed   bool
}

func newListingCache() *listingCache {
	return &listingCache{entries: make(map[string]listingEntry)}
}

// answer is the verdict kept for this path, and whether one was kept for the very
// file that reads as this one does.
func (cache *listingCache) answer(path string, file fs.FileInfo) (bool, bool) {
	cache.mu.Lock()
	defer cache.mu.Unlock()
	entry, kept := cache.entries[path]
	if !kept || entry.size != file.Size() || !entry.modified.Equal(file.ModTime()) {
		return false, false
	}
	return entry.listed, true
}

// remember keeps a verdict against the file it was made from.
func (cache *listingCache) remember(path string, file fs.FileInfo, listed bool) {
	cache.mu.Lock()
	defer cache.mu.Unlock()
	cache.entries[path] = listingEntry{modified: file.ModTime(), size: file.Size(), listed: listed}
}

// forget drops a path's verdict, for the write that replaced the file it was made
// from: a save is answered by the file it left, not by the one it replaced.
func (cache *listingCache) forget(path string) {
	cache.mu.Lock()
	defer cache.mu.Unlock()
	delete(cache.entries, path)
}

// keep drops every path the folder no longer holds, so a folder that loses files
// does not go on answering about them from a map.
func (cache *listingCache) keep(present map[string]bool) {
	cache.mu.Lock()
	defer cache.mu.Unlock()
	for path := range cache.entries {
		if !present[path] {
			delete(cache.entries, path)
		}
	}
}

// serveListing answers `/api/scenes`, the folder's Scenes in one answer.
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

// listScenes: the regular files at the top
// level that pass the name rules and are Scenes, sorted. The folder is listed,
// never walked, so a Scene in a subfolder is out of reach.
func listScenes(folder string, session *core.Session, cache *listingCache) ([]string, error) {
	entries, err := os.ReadDir(folder)
	if err != nil {
		return nil, err
	}
	names := make([]string, 0, len(entries))
	present := make(map[string]bool, len(entries))
	for _, entry := range entries {
		name := entry.Name()
		// A symlink is not a regular file here, so one never reaches the list
		// however its target reads.
		if !entry.Type().IsRegular() || nameProblem(name) != "" {
			continue
		}
		path := filepath.Join(folder, name)
		present[path] = true
		listed, err := listedAsScene(folder, name, session, cache)
		if err != nil {
			return nil, err
		}
		if listed {
			names = append(names, name)
		}
	}
	// What the folder holds is what the cache may hold: a name that is gone, or is
	// no longer a regular file, is forgotten with the answer made from it.
	cache.keep(present)
	// `localeCompare`, as the listing sorts: a name's case decides nothing
	// until two names are the same letters, and then it decides in the lowercase
	// name's favour. Two names that fold to one string first disagree at a letter's
	// case, so comparing them as they are and reading the answer backwards is that
	// order — `'a'` sorts before `'A'`. (`localeCompare` is ICU's, so names outside
	// ASCII keep an order no Go sort can copy without a collation package; these
	// ones match it.)
	sort.Slice(names, func(left, right int) bool {
		one, other := strings.ToLower(names[left]), strings.ToLower(names[right])
		if one != other {
			return one < other
		}
		return names[left] > names[right]
	})
	return names, nil
}

// listedAsScene is `listedAsScene` in `src/paths.ts`: an `.esbozo` is this
// project's own extension and is listed however it reads, so opening it can say
// what is wrong with it, while a `.json` is any other JSON file's too and is
// kept only when its bytes parse as a Scene.
func listedAsScene(folder, name string, session *core.Session, cache *listingCache) (bool, error) {
	if sceneExtension(name) == ".esbozo" {
		return true, nil
	}
	return parsesAsScene(filepath.Join(folder, name), session, cache)
}

// parsesAsScene: a file over
// maxListedSceneBytes is not read at all, and one that is gone, unreadable or a
// folder is left out of the listing rather than failing it. An answer the cache
// already made about this very file stands in place of reading it, and the read
// and the parse happen with no lock of the cache's held.
func parsesAsScene(path string, session *core.Session, cache *listingCache) (bool, error) {
	found, err := os.Stat(path)
	if err != nil {
		if cannotList(err) {
			return false, nil
		}
		return false, err
	}
	if found.Size() > maxListedSceneBytes {
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
	// The answer is kept against the file as it was before the read, so a file
	// written while it was being read keeps no answer at all: what is on disk then
	// is not the file this verdict belongs to, and the next listing reads it again.
	cache.remember(path, found, parsed.OK)
	return parsed.OK, nil
}

// cannotList: a file the listing cannot read is
// not a Scene it can offer.
func cannotList(err error) bool {
	return errors.Is(err, fs.ErrNotExist) ||
		errors.Is(err, fs.ErrPermission) ||
		errors.Is(err, syscall.EPERM) ||
		errors.Is(err, syscall.EISDIR)
}

// serveScene answers `/api/scenes/<name>`: the Scene's own bytes exactly as they
// are on disk, or the write `PUT` and `POST` spell. As `docs/save-api.md` orders
// them: the name first, then whether it stays in the folder, then the method, and
// only then what the method asks of the file.
func serveScene(response http.ResponseWriter, request *http.Request, folder, encodedName string, readOnly bool, session *core.Session, writes *writeQueue, cache *listingCache) {
	name, err := url.PathUnescape(encodedName)
	if err != nil || !utf8.ValidString(name) {
		sendJSON(response, http.StatusBadRequest, problem{"the Scene name is not valid percent-encoding"})
		return
	}
	if refusal := nameProblem(name); refusal != "" {
		sendJSON(response, http.StatusBadRequest, problem{refusal})
		return
	}

	path := filepath.Join(folder, name)
	if !staysInside(folder, path) {
		sendJSON(response, http.StatusForbidden, problem{name + " leaves the folder"})
		return
	}

	if request.Method == http.MethodPut || request.Method == http.MethodPost {
		serveWrite(response, request, folder, name, readOnly, session, writes, cache)
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

// nameProblem: what a Scene name has to be,
// as one path segment at the top level of the folder, ending in a Scene's
// extension. It is "" for a name the API answers on.
func nameProblem(name string) string {
	switch {
	case name == "":
		return "the Scene name is missing"
	case strings.ContainsAny(name, `/\`):
		return name + ": name a Scene in the folder, not a path"
	case name == "." || name == ".." || strings.HasPrefix(name, "."):
		return name + ": name a Scene file, not a hidden or relative one"
	case sceneExtension(name) == "":
		return name + ": a Scene file ends in .esbozo or .json"
	}
	return ""
}

// sceneExtension is `sceneExtension` in `src/paths.ts`: the extension a Scene
// file name ends in, in any letter case, and "" for a name that is not one.
func sceneExtension(name string) string {
	folded := strings.ToLower(name)
	for _, extension := range []string{".esbozo", ".json"} {
		if strings.HasSuffix(folded, extension) {
			return extension
		}
	}
	return ""
}

// staysInside: the name rules already make a
// Scene one segment at the top level, so what is left is the link a person may
// have left there — a Scene that resolves outside the folder is refused, and one
// whose file is not there yet stays inside, because that is a Scene not found.
func staysInside(folder, path string) bool {
	resolved, err := filepath.EvalSymlinks(path)
	if err != nil {
		return errors.Is(err, fs.ErrNotExist)
	}
	return strings.HasPrefix(resolved, folder+string(filepath.Separator))
}

// readScene: a Scene's bytes exactly as they
// are on disk, and false for a name that is not a file — there is no such file,
// or the name belongs to a folder.
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
