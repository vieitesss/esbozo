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

const defaultPort = 4320

const healthAPI = "/api/health"

type serveArguments struct {
	folder   string
	host     string
	port     int
	readOnly bool
}

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
	session, err := core.Open()
	if err != nil {
		_ = listening.Close()
		fmt.Fprintf(stderr, "ez could not run serve: %s\n", err)
		return exitWriteFailed
	}
	server := &http.Server{Handler: handler(root, parsed.readOnly, session)}

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

func serveURL(listening net.Listener) string {
	return "http://" + listening.Addr().String()
}

func modeOf(readOnly bool) string {
	if readOnly {
		return " (read-only)"
	}
	return ""
}

func buildLine() string {
	if esbozo.BuiltAt == "" {
		return "build " + esbozo.Build
	}
	return "build " + esbozo.Build + ", " + esbozo.BuiltAt
}

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

func isSeparator(r rune) bool {
	return r == '/' || r == '\\'
}
