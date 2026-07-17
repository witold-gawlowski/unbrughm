package world

import (
	"path/filepath"
	"testing"
)

func TestSaveLoadRoundTrip(t *testing.T) {
	w := Parse("#.#\n...\n#.#\n")
	w.Dig(5, -3) // a runtime dig on top of the map holes

	path := filepath.Join(t.TempDir(), "world.save")
	if err := w.Save(path); err != nil {
		t.Fatalf("Save: %v", err)
	}

	got, ok, err := Load(path)
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if !ok {
		t.Fatal("Load reported the save missing")
	}

	want := w.DugCells()
	if len(got.DugCells()) != len(want) {
		t.Fatalf("restored %d cells, want %d", len(got.DugCells()), len(want))
	}
	for _, c := range want {
		if got.IsSolid(c.X, c.Z) {
			t.Errorf("restored world missing dug cell %v", c)
		}
	}
}

func TestLoadMissingFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "does-not-exist.save")
	w, ok, err := Load(path)
	if err != nil {
		t.Fatalf("Load of missing file errored: %v", err)
	}
	if ok || w != nil {
		t.Fatalf("missing file should give (nil, false), got (%v, %v)", w, ok)
	}
}
