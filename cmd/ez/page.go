package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"sort"
	"strconv"
	"strings"

	"esbozo"
)

type pageAsset struct {
	path string
	file string
	mime string
}

const fontFile = "dist/fonts/Kalam-Regular.ttf"

var pageAssets = []pageAsset{
	{"/", "dist/editor.html", "text/html; charset=utf-8"},
	{"/editor.html", "dist/editor.html", "text/html; charset=utf-8"},
	{"/editor.css", "dist/editor.css", "text/css; charset=utf-8"},
	{"/editor.js", "dist/editor.js", "text/javascript; charset=utf-8"},
	{"/fonts/Kalam-Regular.ttf", fontFile, "font/ttf"},
	{"/fonts/OFL.txt", "dist/fonts/OFL.txt", "text/plain; charset=utf-8"},
}

type health struct {
	Build   string `json:"build"`
	BuiltAt string `json:"builtAt,omitempty"`
}

type problem struct {
	Error string `json:"error"`
}

type coding string

const (
	brotli   coding = "br"
	gzip     coding = "gzip"
	identity coding = "identity"
)

var codings = []coding{brotli, gzip, identity}

var suffix = map[coding]string{brotli: ".br", gzip: ".gz"}

const (
	refused  = 0.0
	unranked = -1.0
)

type weighted struct {
	coding coding
	weight float64
}

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
	for _, offered := range takenBy(acceptedEncodings(request)) {
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

func acceptedEncodings(request *http.Request) string {
	return strings.Join(request.Header.Values("accept-encoding"), ", ")
}

func pageAssetAt(pathname string) (pageAsset, bool) {
	for _, asset := range pageAssets {
		if asset.path == pathname {
			return asset, true
		}
	}
	return pageAsset{}, false
}

func pageFile(name string) ([]byte, error) {
	if name == fontFile {
		return esbozo.Kalam, nil
	}
	return esbozo.PageFiles.ReadFile(name)
}

func sendPageFile(response http.ResponseWriter, asset pageAsset, offered coding) {
	name := asset.file + suffix[offered]
	bytes, err := pageFile(name)
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

func weigh(value string) float64 {
	weight, err := strconv.ParseFloat(strings.TrimSpace(value), 64)
	if err != nil || math.IsNaN(weight) || math.IsInf(weight, 0) {
		return refused
	}
	return weight
}

func sendJSON(response http.ResponseWriter, status int, body any) {
	var encoded bytes.Buffer
	encoder := json.NewEncoder(&encoded)
	encoder.SetEscapeHTML(false)
	if err := encoder.Encode(body); err != nil {
		http.Error(response, err.Error(), http.StatusInternalServerError)
		return
	}
	header := response.Header()
	header.Set("content-type", "application/json; charset=utf-8")
	header.Set("cache-control", "no-store")
	response.WriteHeader(status)
	_, _ = response.Write(bytes.TrimSuffix(encoded.Bytes(), []byte("\n")))
}
