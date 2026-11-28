package core

import (
	"maps"
	"slices"
	"testing"

	"github.com/dop251/goja"
)

// The commands whose request is a typed option struct, by kind.
var optionCommands = []struct {
	kind    string
	options any
}{
	{"render", RenderOptions{}},
	{"check", CheckOptions{}},
	{"png", PNGOptions{}},
	{"anchor", AnchorOptions{}},
	{"snap", SnapOptions{}},
}

func TestExitCodesMatchTheCoresTable(t *testing.T) {
	named := map[string]int{
		"ok":                 ExitOK,
		"usage":              ExitUsage,
		"invalidScene":       ExitInvalidScene,
		"writeFailed":        ExitWriteFailed,
		"missingThemeOrFont": ExitMissingThemeOrFont,
		"labelOverflow":      ExitLabelOverflow,
	}
	exits := describe(t).exits
	if !maps.Equal(exits, named) {
		t.Fatalf("the core exits with %v, and Go names %v", exits, named)
	}
}

func TestOptionKeysMatchTheCoresCommands(t *testing.T) {
	described := describe(t)
	for _, entry := range optionCommands {
		takes, has := described.takes[entry.kind]
		if !has {
			t.Fatalf("the core has no %s command", entry.kind)
		}
		sent := slices.Sorted(maps.Keys(fieldsOf(entry.options)))
		declared := optionsOf(takes)
		if !slices.Equal(sent, declared) {
			t.Fatalf("%s sends keys %v, and the core declares %v", entry.kind, sent, declared)
		}
	}

	// The two commands with no option struct: parse reads the Scene alone, and
	// describe declares no request keys at all.
	if !slices.Equal(described.takes["parse"], []string{"source"}) {
		t.Fatalf("parse declares keys %v, and Go sends only the Scene", described.takes["parse"])
	}
	if takes := described.takes["describe"]; len(takes) != 0 {
		t.Fatalf("describe declares keys %v, and Go sends none", takes)
	}
}

// described is what `describe` answers: the exit table, and each command's request keys.
type described struct {
	exits map[string]int
	takes map[string][]string
}

func describe(t *testing.T) described {
	t.Helper()
	session, err := Open()
	if err != nil {
		t.Fatal(err)
	}
	var answer *goja.Object
	// describe takes no request keys, so its request is empty.
	err = session.call("describe",
		func(vm *goja.Runtime) (*goja.Object, error) { return vm.NewObject(), nil },
		func(object *goja.Object) error {
			answer = object
			return nil
		})
	if err != nil {
		t.Fatalf("describe: %v", err)
	}

	exitTable, ok := answer.Get("exit").(*goja.Object)
	if !ok {
		t.Fatal("describe answered no exit table")
	}
	exits := make(map[string]int, len(exitTable.Keys()))
	for _, name := range exitTable.Keys() {
		exits[name] = int(exitTable.Get(name).ToInteger())
	}

	commandTable, ok := answer.Get("commands").(*goja.Object)
	if !ok {
		t.Fatal("describe answered no command table")
	}
	takes := make(map[string][]string, len(commandTable.Keys()))
	for _, kind := range commandTable.Keys() {
		takes[kind] = linesOf(commandTable.Get(kind))
	}
	return described{exits: exits, takes: takes}
}

// optionsOf is the request keys of one command that a typed option struct sends.
func optionsOf(takes []string) []string {
	keys := make([]string, 0, len(takes))
	for _, key := range takes {
		if key != "source" {
			keys = append(keys, key)
		}
	}
	slices.Sort(keys)
	return keys
}
