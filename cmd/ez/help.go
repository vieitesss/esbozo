// Help text for the `ez` command line: the words are `src/help.ts`'s, written
// out again here while both CLIs exist, and a test holds the two to the same
// help. Section headings are bold only for a terminal without `NO_COLOR`.
package main

import (
	"fmt"
	"io"
	"os"
	"strings"
)

const placeList = "top, bottom, left, right, center, top-left, top-right, bottom-left, bottom-right"

// anchorUsageLine and snapUsageLine are `USAGE_LINE.anchor` and `USAGE_LINE.snap`
// in `src/help.ts`, word for word: what `anchor` and `snap` print when they refuse
// the arguments they were given.
const (
	anchorUsageLine = "usage: ez anchor <scene> <element> <start|end> <place>\n" +
		"       ez anchor <scene> --all\n" +
		`  place: ` + placeList + `, a pair of fractions "fx,fy", or none`
	snapUsageLine = "usage: ez snap <scene> <element> <start|end> <target|off>"
)

var cssSubsetLines = []string{
	"  `:root` and `html` declarations are the light theme; dark is those values",
	"  overridden by `@media (prefers-color-scheme: dark)` blocks and by `:root.dark`,",
	"  `:root[data-theme=\"dark\"]`, `html.dark` and `html[data-theme=\"dark\"]`. Other",
	"  selectors and every other grouping at-rule are ignored. Values may use `var()`",
	"  and `color-mix(in srgb, A p%, B)` with hex, rgb()/rgba() or CSS colour names.",
	"  Palette colours must be opaque.",
}

// exitCodeRows is the exit table, as `src/cli.ts` defines it.
var exitCodeRows = [][2]string{
	{"0", "the Scene is clean, was rendered, the PNG or the bundle was written, or the server stopped"},
	{"2", "wrong arguments (unknown command, missing or extra arguments, bad flag)"},
	{"3", "the Scene could not be read or parsed"},
	{"4", "the output could not be written, the server could not start, or the editor is not built"},
	{"5", "missing theme values, or a missing or unreadable font"},
	{"6", "a Label that does not fit its Element (see `ez check`)"},
}

var commandGroups = []struct {
	heading string
	rows    [][2]string
}{
	{"MAKE", [][2]string{
		{"render", "Write <name>.svg beside the Scene and print its path"},
		{"png", "Write <name>.<theme>.png beside the Scene and print its path"},
		{"bundle", "Write the embeddable editor module <dir>/esbozo-<version>.js"},
	}},
	{"CHECK", [][2]string{
		{"check", "Validate a Scene and check that every Label fits its Element"},
		{"anchor", "Place or freeze a Snapped end's Anchor on its target's outline"},
		{"snap", "Attach an arrow or line end to an Element, or turn Snap off"},
	}},
	{"EDIT", [][2]string{
		{"serve", "Serve the browser editor and save API on a folder of Scenes"},
	}},
	{"AGENTS", [][2]string{
		{"skill", "Print the esbozo agent skill, or install it (`ez skill install`)"},
	}},
}

var examples = []string{
	"  ez check diagram.esbozo",
	"  ez png diagram.esbozo --theme light",
	"  ez render diagram.esbozo",
	"  ez serve ./diagrams",
}

type commandHelpSpec struct {
	summary        string
	usage          []string
	optionsHeading string
	options        [][2]string
	example        string
}

var commandHelpSpecs = map[string]commandHelpSpec{
	"render": {
		summary: "Write <name>.svg beside the Scene and print its path.",
		usage:   []string{"ez render <scene> [--font <file>]"},
		options: [][2]string{
			{"--font <file>", "Font file used to measure Labels (default: bundled Kalam)"},
		},
		example: "ez render diagram.esbozo",
	},
	"png": {
		summary: "Write <name>.<theme>.png beside the Scene and print its path.",
		usage: []string{
			"ez png <scene> --theme light|dark [--css <stylesheet>]",
			"       [--ink <colour>] [--paper <colour>] [--muted <colour>] [--font <file>]",
		},
		options: [][2]string{
			{"--theme light|dark", "Theme to render (required)"},
			{"--css <stylesheet>", "Stylesheet providing theme colours and --font-hand (default: built-in theme)"},
			{"--ink <colour>", "Override ink colour (opaque)"},
			{"--paper <colour>", "Override paper colour (opaque)"},
			{"--muted <colour>", "Override muted colour (opaque)"},
			{"--font <file>", "Font file used to measure and draw text (default: stylesheet @font-face or bundled Kalam)"},
		},
		example: "ez png diagram.esbozo --theme light",
	},
	"bundle": {
		summary: "Write the embeddable <esbozo-editor> ES module to <dir>/esbozo-<version>.js.",
		usage:   []string{"ez bundle <dir>"},
		example: "ez bundle public/",
	},
	"check": {
		summary: "Validate a Scene and check that every Label fits its Element. Prints nothing when clean.",
		usage:   []string{"ez check <scene> [--font <file>] [--css <stylesheet>]"},
		options: [][2]string{
			{"--font <file>", "Font file used to measure Labels (default: stylesheet @font-face or bundled Kalam)"},
			{"--css <stylesheet>", "Stylesheet read for the light theme's --font-hand"},
		},
		example: "ez check diagram.esbozo",
	},
	"anchor": {
		summary: "Place a Snapped end's Anchor on its target's outline, or freeze all unanchored Snapped ends.",
		usage:   []string{"ez anchor <scene> <element> <start|end> <place>", "ez anchor <scene> --all"},
		options: [][2]string{
			{"<place>", placeList + `, a pair of fractions "fx,fy", or none`},
			{"--all", "Freeze every Snapped end that carries no Anchor where it draws today"},
		},
		example: "ez anchor diagram.esbozo a-b end left",
	},
	"snap": {
		summary: "Attach an arrow or line end to an Element at the nearest outline point, or turn Snap off.",
		usage:   []string{"ez snap <scene> <element> <start|end> <target|off>"},
		example: "ez snap diagram.esbozo a-b end target-box",
	},
	"serve": {
		summary: "Serve the browser editor and save API on a folder of Scenes.",
		usage:   []string{"ez serve <dir> [--host 127.0.0.1] [--port N] [--read-only]"},
		options: [][2]string{
			{"--host <host>", "Address to bind (default: 127.0.0.1)"},
			{"--port <N>", "Port to listen on; 0 picks a free port (default: 4320)"},
			{"--read-only", "Show Scenes and refuse all saves"},
		},
		example: "ez serve ./diagrams --port 0",
	},
	"skill": {
		summary:        "Print the shipped esbozo agent skill to stdout, or install it into a skills folder.",
		usage:          []string{"ez skill [install [--dir <path>]]"},
		optionsHeading: "SUBCOMMANDS",
		options: [][2]string{
			{"install [--dir <path>]", "Copy SKILL.md to <path>/esbozo/SKILL.md (default: ~/.agents/skills)"},
		},
		example: "ez skill install",
	},
	"skill install": {
		summary: "Copy the shipped esbozo/SKILL.md into a skills folder and print the written path.",
		usage:   []string{"ez skill install [--dir <path>]"},
		options: [][2]string{
			{"--dir <path>", "Target skills folder (default: ~/.agents/skills)"},
		},
		example: "ez skill install --dir ~/.agents/skills",
	},
}

func helpTopicFor(command string, rest []string) string {
	if command == "skill" && len(rest) == 2 && rest[0] == "install" && rest[1] == "--help" {
		return "skill install"
	}
	if len(rest) != 1 || rest[0] != "--help" {
		return ""
	}
	if _, known := commandHelpSpecs[command]; !known {
		return ""
	}
	return command
}

func heading(text string, bold bool) string {
	if !bold {
		return text
	}
	return "\x1b[1m" + text + "\x1b[0m"
}

func alignedRows(rows [][2]string, minWidth int) []string {
	width := minWidth
	for _, row := range rows {
		if len(row[0]) > width {
			width = len(row[0])
		}
	}
	lines := make([]string, 0, len(rows))
	for _, row := range rows {
		lines = append(lines, "  "+row[0]+strings.Repeat(" ", width-len(row[0]))+"  "+row[1])
	}
	return lines
}

func section(title string, body []string, bold bool) string {
	return strings.Join(append([]string{heading(title, bold)}, body...), "\n")
}

func topLevelHelp(bold bool) string {
	commandWidth := 0
	for _, group := range commandGroups {
		for _, row := range group.rows {
			if len(row[0]) > commandWidth {
				commandWidth = len(row[0])
			}
		}
	}
	sections := []string{
		"ez — hand-drawn diagrams as JSON Scenes",
		section("USAGE", []string{"  ez <command> [arguments]", "  ez <command> --help"}, bold),
	}
	for _, group := range commandGroups {
		sections = append(sections, section(group.heading, alignedRows(group.rows, commandWidth), bold))
	}
	sections = append(sections,
		section("CSS SUBSET", cssSubsetLines, bold),
		section("EXIT CODES", alignedRows(exitCodeRows, 1), bold),
		section("EXAMPLES", examples, bold),
	)
	return strings.Join(sections, "\n\n") + "\n"
}

func commandHelp(topic string, bold bool) string {
	spec := commandHelpSpecs[topic]
	usage := make([]string, len(spec.usage))
	for index, line := range spec.usage {
		usage[index] = "  " + line
	}
	sections := []string{spec.summary, section("USAGE", usage, bold)}
	if len(spec.options) > 0 {
		title := spec.optionsHeading
		if title == "" {
			title = "FLAGS"
		}
		sections = append(sections, section(title, alignedRows(spec.options, 1), bold))
	}
	sections = append(sections, section("EXAMPLE", []string{"  " + spec.example}, bold))
	return strings.Join(sections, "\n\n") + "\n"
}

func runHelp(argv []string, stdout, stderr io.Writer) int {
	if len(argv) == 0 {
		fmt.Fprint(stdout, topLevelHelp(shouldBold(stdout)))
		return exitOK
	}
	topic := helpTopicFor(argv[0], append(append([]string{}, argv[1:]...), "--help"))
	if topic == "" {
		fmt.Fprint(stderr, topLevelHelp(false))
		return exitUsage
	}
	fmt.Fprint(stdout, commandHelp(topic, shouldBold(stdout)))
	return exitOK
}

// shouldBold is `shouldBold` in `src/help.ts`: a terminal that `NO_COLOR` has
// not turned off. Node reads `NO_COLOR` as set unless the variable is absent, so
// an empty value turns bold off there and here.
func shouldBold(stream io.Writer) bool {
	file, isFile := stream.(*os.File)
	if !isFile || !isTerminal(file) {
		return false
	}
	_, turnedOff := os.LookupEnv("NO_COLOR")
	return !turnedOff
}
