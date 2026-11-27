// The page's own files, and the coding each one travels in: the only paths `ez
// serve` answers with something other than JSON. The bytes are `esbozo.PageFiles`,
// embedded beside the core, so the page a browser loads is the one this binary
// carries and nothing is read beside it — which is what makes a Go build without
// the page fail here rather than answer a page it does not have.
package main

import (
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"sort"
	"strconv"
	"strings"

	"esbozo"
)

// pageAsset is one path the page is served at, as `PAGE_ASSETS` in
// `src/page-assets.ts` lists them.
type pageAsset struct {
	// path is the request path, exactly as written.
	path string
	// file is the built file it is served from.
	file string
	// mime is what the answer says it is. A text type is the one the build
	// compresses beside itself.
	mime string
}

var pageAssets = []pageAsset{
	{"/", "dist/editor.html", "text/html; charset=utf-8"},
	{"/editor.html", "dist/editor.html", "text/html; charset=utf-8"},
	{"/editor.css", "dist/editor.css", "text/css; charset=utf-8"},
	{"/editor.js", "dist/editor.js", "text/javascript; charset=utf-8"},
	{"/fonts/Kalam-Regular.ttf", "dist/fonts/Kalam-Regular.ttf", "font/ttf"},
	{"/fonts/OFL.txt", "dist/fonts/OFL.txt", "text/plain; charset=utf-8"},
}

// health is `GET /api/health`'s answer, in the two words `docs/save-api.md`
// gives: the build the server is, and when it was made, which a build that
// wrote no time leaves out.
type health struct {
	Build   string `json:"build"`
	BuiltAt string `json:"builtAt,omitempty"`
}

// problem is every failure's answer: `{ "error": "<message>" }`.
type problem struct {
	Error string `json:"error"`
}

// coding is one content coding a page's file travels in. Every text page file
// travels as brotli or gzip, or as itself; the font's own format is the
// compression, so it travels as itself.
type coding string

const (
	brotli   coding = "br"
	gzip     coding = "gzip"
	identity coding = "identity"
)

// codings are the ones a page file travels in, best first: the two the build
// writes beside each text file, and then the file itself.
var codings = []coding{brotli, gzip, identity}

// suffix is the extension the build writes a coding's bytes under.
var suffix = map[coding]string{brotli: ".br", gzip: ".gz"}

// The weights a request's `accept-encoding` can leave an encoding with: a weight
// of zero is an encoding it said no to, and identity that it said nothing about
// ranks below every coding it named.
const (
	refused  = 0.0
	unranked = -1.0
)

// weighted is one coding and what a request would give it.
type weighted struct {
	coding coding
	weight float64
}

// servePageFile answers one path with a page file, in the best coding the
// request takes.
func servePageFile(response http.ResponseWriter, request *http.Request, pathname string) {
	if request.Method != http.MethodGet {
		sendJSON(response, http.StatusMethodNotAllowed, problem{"use GET"})
		return
	}
	asset, known := pageAssetAt(pathname)
	if !known {
		sendJSON(response, http.StatusNotFound, problem{fmt.Sprintf("no page file %s", pathname)})
		return
	}

	compressed := strings.HasPrefix(asset.mime, "text/")
	for _, offered := range takenBy(request.Header.Get("accept-encoding")) {
		if offered != identity && !compressed {
			continue
		}
		sendPageFile(response, asset, offered)
		return
	}
	response.Header().Set("vary", "accept-encoding")
	if compressed {
		sendJSON(response, http.StatusNotAcceptable, problem{
			"this page is sent as br, gzip or with no content coding, and the request takes none of them",
		})
		return
	}
	sendJSON(response, http.StatusNotAcceptable, problem{
		"this page is sent with no content coding, and the request takes none of it",
	})
}

// pageAssetAt is the page file one path names, and whether the page has it.
func pageAssetAt(pathname string) (pageAsset, bool) {
	for _, asset := range pageAssets {
		if asset.path == pathname {
			return asset, true
		}
	}
	return pageAsset{}, false
}

// sendPageFile writes the file a coding carries, or the file itself.
func sendPageFile(response http.ResponseWriter, asset pageAsset, offered coding) {
	name := asset.file + suffix[offered]
	// The bytes are embedded, so this read only fails if the table above and the
	// embed list disagree.
	bytes, err := esbozo.PageFiles.ReadFile(name)
	if err != nil {
		sendJSON(response, http.StatusInternalServerError, problem{err.Error()})
		return
	}
	header := response.Header()
	header.Set("content-type", asset.mime)
	header.Set("cache-control", "no-store")
	header.Set("vary", "accept-encoding")
	if offered != identity {
		header.Set("content-encoding", string(offered))
		header.Set("content-length", strconv.Itoa(len(bytes)))
	}
	response.WriteHeader(http.StatusOK)
	_, _ = response.Write(bytes)
}

// takenBy is `takenBy` in `src/serve.ts`: what a request takes of what a page
// file can be sent in, best first.
//
// Every encoding is ranked by its weight, `identity` — the file as it is —
// included: a client that gives it the highest q gets the plain bytes, because
// that is what it said it would rather have. Ties keep the order above: the
// page prefers its best compression, and the file itself last. A header with no
// weight, or a weight of zero, is an encoding the client does not take; `*`
// stands for the ones it does not name.
//
// Identity is acceptable unless the request refuses it, by name or by refusing
// everything it does not name. Unnamed and unweighed, it is still acceptable but
// ranks below every coding the request gives a weight to, so `gzip;q=0.3` is
// answered with gzip: a client that says nothing about the file itself has not
// asked for it instead of the compression it did ask for.
func takenBy(header string) []coding {
	weights := map[string]float64{}
	for _, part := range strings.Split(header, ",") {
		pieces := strings.Split(strings.ToLower(strings.TrimSpace(part)), ";")
		name := strings.TrimSpace(pieces[0])
		if name == "" {
			continue
		}
		weight := 1.0
		for _, parameter := range pieces[1:] {
			key, value, found := strings.Cut(strings.TrimSpace(parameter), "=")
			if found && strings.TrimSpace(key) == "q" {
				weight = weigh(value)
			}
		}
		weights[name] = weight
	}

	unnamed, hasUnnamed := weights["*"]
	ranked := make([]weighted, 0, len(codings))
	for _, offered := range codings {
		ranked = append(ranked, weighted{offered, weightOf(weights, offered, unnamed, hasUnnamed)})
	}
	sort.SliceStable(ranked, func(left, right int) bool {
		return ranked[left].weight > ranked[right].weight
	})

	taken := make([]coding, 0, len(ranked))
	for _, offer := range ranked {
		if offer.weight != refused {
			taken = append(taken, offer.coding)
		}
	}
	return taken
}

// weightOf is one encoding's weight: what the request gave it by name, or what
// it gave everything it did not name, or nothing at all. Identity alone is still
// acceptable when the request says nothing.
func weightOf(weights map[string]float64, offered coding, unnamed float64, hasUnnamed bool) float64 {
	if weight, named := weights[string(offered)]; named {
		return weight
	}
	if offered == identity {
		if hasUnnamed && unnamed == refused {
			return refused
		}
		return unranked
	}
	if hasUnnamed {
		return unnamed
	}
	return refused
}

// weigh is `Number(value)` and `Number.isFinite` as a weight: what is not a
// number is an encoding the client does not take.
func weigh(value string) float64 {
	weight, err := strconv.ParseFloat(strings.TrimSpace(value), 64)
	if err != nil || math.IsNaN(weight) || math.IsInf(weight, 0) {
		return refused
	}
	return weight
}

// sendJSON answers with a body of this server's own: JSON, and never cached,
// which is every route but a page file's.
func sendJSON(response http.ResponseWriter, status int, body any) {
	encoded, err := json.Marshal(body)
	if err != nil {
		// Every body above is a struct of strings, which always encodes.
		http.Error(response, err.Error(), http.StatusInternalServerError)
		return
	}
	header := response.Header()
	header.Set("content-type", "application/json; charset=utf-8")
	header.Set("cache-control", "no-store")
	response.WriteHeader(status)
	_, _ = response.Write(encoded)
}
