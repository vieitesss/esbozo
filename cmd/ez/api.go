// The Scene API's two reading routes: the list of Scenes one folder offers, and
// one Scene's own bytes, as `src/serve.ts` answers them and `docs/save-api.md`
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
	"syscall"

	"esbozo/internal/core"
)

// scenesAPI is `SCENES_API` in `src/serve.ts`: where the Scene routes start.
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

// serveListing answers `/api/scenes`, the folder's Scenes in one answer.
func serveListing(response http.ResponseWriter, request *http.Request, folder string, readOnly bool, session *core.Session) {
	if request.Method != http.MethodGet {
		sendJSON(response, http.StatusMethodNotAllowed, problem{"use GET"})
		return
	}
	scenes, err := listScenes(folder, session)
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

// listScenes is `listScenes` in `src/serve.ts`: the regular files at the top
// level that pass the name rules and are Scenes, sorted. The folder is listed,
// never walked, so a Scene in a subfolder is out of reach.
func listScenes(folder string, session *core.Session) ([]string, error) {
	entries, err := os.ReadDir(folder)
	if err != nil {
		return nil, err
	}
	names := make([]string, 0, len(entries))
	for _, entry := range entries {
		name := entry.Name()
		// A symlink is not a regular file here, so one never reaches the list
		// however its target reads.
		if !entry.Type().IsRegular() || nameProblem(name) != "" {
			continue
		}
		listed, err := listedAsScene(folder, name, session)
		if err != nil {
			return nil, err
		}
		if listed {
			names = append(names, name)
		}
	}
	// `localeCompare`, as `src/serve.ts` sorts: a name's case decides nothing
	// until two names are the same letters, and then the bytes do. `localeCompare`
	// is ICU's, so names outside ASCII keep an order no Go sort can copy without a
	// collation package; these ones match it.
	sort.Slice(names, func(left, right int) bool {
		one, other := strings.ToLower(names[left]), strings.ToLower(names[right])
		if one != other {
			return one < other
		}
		return names[left] < names[right]
	})
	return names, nil
}

// listedAsScene is `listedAsScene` in `src/paths.ts`: an `.esbozo` is this
// project's own extension and is listed however it reads, so opening it can say
// what is wrong with it, while a `.json` is any other JSON file's too and is
// kept only when its bytes parse as a Scene.
func listedAsScene(folder, name string, session *core.Session) (bool, error) {
	if sceneExtension(name) == ".esbozo" {
		return true, nil
	}
	return parsesAsScene(filepath.Join(folder, name), session)
}

// parsesAsScene is `parsesAsScene` in `src/serve.ts`: a file over
// maxListedSceneBytes is not read at all, and one that is gone, unreadable or a
// folder is left out of the listing rather than failing it.
func parsesAsScene(path string, session *core.Session) (bool, error) {
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
	return parsed.OK, nil
}

// cannotList is `cannotList` in `src/serve.ts`: a file the listing cannot read is
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
func serveScene(response http.ResponseWriter, request *http.Request, folder, encodedName string, readOnly bool, session *core.Session, writes *writeQueue) {
	name, err := url.PathUnescape(encodedName)
	if err != nil {
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
		serveWrite(response, request, folder, name, readOnly, session, writes)
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

// nameProblem is `nameProblem` in `src/serve.ts`: what a Scene name has to be,
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

// staysInside is `staysInside` in `src/serve.ts`: the name rules already make a
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

// readScene is `readScene` in `src/serve.ts`: a Scene's bytes exactly as they
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
