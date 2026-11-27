// `serve`: the editor page on one folder of Scenes. Go owns the flags, the
// folder, the listening, the exit codes and the line it prints; what a request
// is answered with is `page.go`'s, and the save API's routes come with them.
package main

import (
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"unicode/utf8"

	"esbozo"
	"esbozo/internal/core"
)

// defaultPort is `DEFAULT_PORT` in `src/cli.ts`: the port a person finds `ez
// serve` on when nothing asked for another one.
const defaultPort = 4320

const healthAPI = "/api/health"

// serveArguments is what one `ez serve` run was asked for.
type serveArguments struct {
	// folder is the folder the Scenes live in, as the run named it.
	folder   string
	host     string
	port     int
	readOnly bool
}

// parseServeArguments reads `<dir> [--host <host>] [--port <N>] [--read-only]`
// in any order, as `parseServeArguments` in `src/cli.ts` does: a flag with no
// value, a port that is not a number of 0 to 65535, an unknown flag and a
// second folder are all wrong arguments. A flag given twice is read twice, so
// the last `--host` wins.
func parseServeArguments(argv []string) (serveArguments, bool) {
	parsed := serveArguments{host: "127.0.0.1", port: defaultPort}
	for index := 0; index < len(argv); index++ {
		argument := argv[index]
		if argument == "--read-only" {
			parsed.readOnly = true
			continue
		}
		if argument == "--host" || argument == "--port" {
			value := ""
			if index+1 < len(argv) {
				value = argv[index+1]
			}
			if value == "" || strings.HasPrefix(value, "--") {
				return serveArguments{}, false
			}
			if argument == "--host" {
				parsed.host = value
			} else {
				port, isPort := parsePort(value)
				if !isPort {
					return serveArguments{}, false
				}
				parsed.port = port
			}
			index++
			continue
		}
		if argument == "" || strings.HasPrefix(argument, "--") || parsed.folder != "" {
			return serveArguments{}, false
		}
		parsed.folder = argument
	}
	if parsed.folder == "" {
		return serveArguments{}, false
	}
	return parsed, true
}

// parsePort is `/^\d+$/.test(value) ? Number(value) : NaN` and its bound: `0`
// lets the operating system pick the port, and nothing above 65535 is one.
func parsePort(value string) (int, bool) {
	for _, digit := range value {
		if digit < '0' || digit > '9' {
			return 0, false
		}
	}
	port, err := strconv.Atoi(value)
	if err != nil || port > 65535 {
		return 0, false
	}
	return port, true
}

// runServe is `ez serve`: it listens until `SIGINT` or `SIGTERM`, which is a
// clean stop, and prints the line that names the folder, the address and the
// build a person is talking to.
func runServe(argv []string, stdout, stderr io.Writer) int {
	parsed, ok := parseServeArguments(argv)
	if !ok {
		fmt.Fprintln(stderr, usageLine["serve"])
		return exitUsage
	}

	folder, err := filepath.Abs(parsed.folder)
	if err != nil {
		fmt.Fprintf(stderr, "cannot read folder %s: %s\n", parsed.folder, err)
		return exitWriteFailed
	}
	// The folder has to be one this run can read before anything is served: a
	// server on a folder nothing can be read from answers 500 to every request.
	if _, err := os.ReadDir(folder); err != nil {
		fmt.Fprintf(stderr, "cannot read folder %s: %s\n", folder, err)
		return exitWriteFailed
	}
	root, err := filepath.EvalSymlinks(folder)
	if err != nil {
		fmt.Fprintf(stderr, "cannot read folder %s: %s\n", folder, err)
		return exitWriteFailed
	}

	listening, err := listenOn(parsed.host, parsed.port)
	if err != nil {
		fmt.Fprintln(stderr, err)
		return exitWriteFailed
	}
	// One core runtime for as long as the server runs: no request pays for a
	// runtime of its own, and the lock inside the session keeps them one at a time.
	session, err := core.Open()
	if err != nil {
		_ = listening.Close()
		fmt.Fprintf(stderr, "ez could not run serve: %s\n", err)
		return exitWriteFailed
	}
	server := &http.Server{Handler: handler(root, parsed.readOnly, session)}

	// SIGINT and SIGTERM stop the server, as `src/cli.ts` listens for them; a
	// signal is the way a person ends a server they started, not a failure.
	signals := make(chan os.Signal, 1)
	signal.Notify(signals, os.Interrupt, syscall.SIGTERM)
	defer signal.Stop(signals)

	fmt.Fprintf(stdout, "serving %s on %s/%s (%s)\n", root, serveURL(listening), modeOf(parsed.readOnly), buildLine())

	served := make(chan error, 1)
	go func() { served <- server.Serve(listening) }()

	select {
	case <-signals:
		_ = server.Close()
		<-served
		return exitOK
	case err := <-served:
		fmt.Fprintln(stderr, err)
		return exitWriteFailed
	}
}

// listenOn is where `ez serve` answers from. A port another program holds is
// the one mistake worth its own words, because `--port 0` is the way past it.
func listenOn(host string, port int) (net.Listener, error) {
	listening, err := net.Listen("tcp", net.JoinHostPort(host, strconv.Itoa(port)))
	if err == nil {
		return listening, nil
	}
	if errors.Is(err, syscall.EADDRINUSE) {
		return nil, fmt.Errorf("port %d on %s is already in use: pass --port N", port, host)
	}
	return nil, fmt.Errorf("cannot listen on %s:%d: %s", host, port, err)
}

// serveURL is `http://host:port` with no trailing slash, so the startup line
// adds the one it means and a request path follows it.
func serveURL(listening net.Listener) string {
	return "http://" + listening.Addr().String()
}

// modeOf is the word between the URL and the build: a folder served read-only
// takes no save, and the line says so.
func modeOf(readOnly bool) string {
	if readOnly {
		return " (read-only)"
	}
	return ""
}

// buildLine is the build the server is, as `src/cli.ts` prints it: the commit
// the binary was built from, and when the build ran, so a server someone finds
// running can say whether it is the one they started.
func buildLine() string {
	if esbozo.BuiltAt == "" {
		return "build " + esbozo.Build
	}
	return "build " + esbozo.Build + ", " + esbozo.BuiltAt
}

// handler is what a request meets, before any route: a path with a dot segment
// or broken percent-encoding, then the health route, then the Scene routes, then
// a page file. `session` is the one core runtime every request answers in, the
// write queues are the run's, so two writes of one Scene are one after the other
// however many requests arrive, and the listing cache is the run's too, so a
// folder listed twice is parsed once.
func handler(folder string, readOnly bool, session *core.Session) http.Handler {
	writes := newWriteQueue()
	listed := newListingCache()
	return http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		answer(response, request, folder, readOnly, session, writes, listed)
	})
}

func answer(response http.ResponseWriter, request *http.Request, folder string, readOnly bool, session *core.Session, writes *writeQueue, listed *listingCache) {
	raw := request.RequestURI
	if raised := rawPathProblem(raw); raised != "" {
		sendJSON(response, http.StatusBadRequest, problem{raised})
		return
	}
	pathname := request.URL.EscapedPath()
	if pathname == healthAPI {
		if request.Method != http.MethodGet {
			sendJSON(response, http.StatusMethodNotAllowed, problem{"use GET"})
			return
		}
		sendJSON(response, http.StatusOK, health{Build: esbozo.Build, BuiltAt: esbozo.BuiltAt})
		return
	}
	if pathname == scenesAPI || pathname == scenesAPI+"/" {
		serveListing(response, request, folder, readOnly, session, listed)
		return
	}
	if strings.HasPrefix(pathname, scenesAPI+"/") {
		serveScene(response, request, folder, strings.TrimPrefix(pathname, scenesAPI+"/"), readOnly, session, writes, listed)
		return
	}
	servePageFile(response, request, pathname)
}

// rawPathProblem is `rawPathProblem` in `src/serve.ts`: a dot segment in the
// request path, decoded but before it is normalised, or a percent-encoding the
// path cannot be read from. `..`, `%2e%2e`, `.` and a backslash for a separator
// are all refused, so no path is read one way here and another way by the URL
// parser. The decode is `decodeURIComponent`'s, which refuses bytes that are no
// text as well as escapes that are no escape.
func rawPathProblem(raw string) string {
	path, _, _ := strings.Cut(raw, "?")
	decoded, err := url.PathUnescape(path)
	if err != nil || !utf8.ValidString(decoded) {
		return "the path is not valid percent-encoding"
	}
	for _, segment := range strings.FieldsFunc(decoded, isSeparator) {
		if segment == "." || segment == ".." {
			return "a request path may not name a folder relative to itself"
		}
	}
	return ""
}

// isSeparator is both separators a path may be written with; a backslash is one
// on the filesystems that read it as one.
func isSeparator(r rune) bool {
	return r == '/' || r == '\\'
}
