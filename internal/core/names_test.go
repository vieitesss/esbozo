package core

import "testing"

func TestNamesReadsAFileNameIntoTheFileNamesAndTheListing(t *testing.T) {
	session, err := Open()
	if err != nil {
		t.Fatal(err)
	}

	names, err := session.Names("Flow.ESBOZO", "dark")
	if err != nil {
		t.Fatalf("names: %v", err)
	}
	if !names.OK {
		t.Fatalf("naming a Scene's files answered ok=%v, and naming is a query", names.OK)
	}
	if names.Problem != "" {
		t.Errorf("a .esbozo name has the problem %q, and it is a Scene name", names.Problem)
	}
	if names.Stem != "Flow" || names.SVG != "Flow.svg" || names.PNG != "Flow.dark.png" {
		t.Errorf("the name answers stem=%q svg=%q png=%q", names.Stem, names.SVG, names.PNG)
	}
	if names.Listed != SceneListingAlways {
		t.Errorf("a .esbozo name lists as %q, and a listing takes it without reading it", names.Listed)
	}
	if names.MaxListedSceneBytes != 5*1024*1024 {
		t.Errorf("a listing reads up to %d bytes, not %d", names.MaxListedSceneBytes, 5*1024*1024)
	}
}

func TestNamesWithoutAThemeNamesNoPNG(t *testing.T) {
	names, err := Names("flow.json", "")
	if err != nil {
		t.Fatalf("names: %v", err)
	}
	if names.PNG != "" {
		t.Errorf("a Scene named with no theme names the PNG %q, and a PNG needs a theme", names.PNG)
	}
	if names.Stem != "flow" || names.SVG != "flow.svg" {
		t.Errorf("the name answers stem=%q svg=%q", names.Stem, names.SVG)
	}
	if names.Listed != SceneListingIfScene {
		t.Errorf("a .json name lists as %q, and a listing reads it before taking it", names.Listed)
	}
}

func TestNamesAnswersWhyANameIsNoSceneName(t *testing.T) {
	names, err := Names("../flow.esbozo", "")
	if err != nil {
		t.Fatalf("names: %v", err)
	}
	const refusal = "../flow.esbozo: name a Scene in the folder, not a path"
	if names.Problem != refusal {
		t.Errorf("a path answers %q, and `ez serve` refuses it with %q", names.Problem, refusal)
	}
	if names.SVG != "../flow.svg" {
		t.Errorf("a refused name still answers its SVG as %q, so a caller never branches before naming", names.SVG)
	}
}
