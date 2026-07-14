package world

import "testing"

func TestParseCenteredOnOrigin(t *testing.T) {
	// 3x3 grid with a dug center: origin lands on the center cell.
	w := Parse("###\n#.#\n###\n")
	if w.IsSolid(0, 0) {
		t.Error("center cell should be dug")
	}
	for _, c := range []Cell{{-1, -1}, {0, -1}, {1, -1}, {-1, 0}, {1, 0}, {-1, 1}, {0, 1}, {1, 1}} {
		if !w.IsSolid(c.X, c.Z) {
			t.Errorf("cell %v should be solid", c)
		}
	}
	if !w.IsSolid(5, 5) {
		t.Error("cells outside the map should be solid")
	}
}

func TestParseSkipsCommentsAndBlankLines(t *testing.T) {
	w := Parse("; a comment\n\n###\n#.#\n###\n\n; trailing comment\n")
	if w.IsSolid(0, 0) {
		t.Error("center cell should be dug; comments/blanks must not shift rows")
	}
	if got := len(w.DugCells()); got != 1 {
		t.Errorf("want 1 dug cell, got %d", got)
	}
}

func TestParseRaggedRowsAndCRLF(t *testing.T) {
	// Width = longest row (4). Short rows' missing cells count as dug,
	// matching the client's (rows[row][col] ?? '') !== '#'.
	w := Parse("####\r\n##\r\n####\r\n")
	// Row 1 (z=0 after centering: originZ=1, originX=2): cols 2,3 are past
	// the short row's end -> dug.
	if w.IsSolid(0, 0) || w.IsSolid(1, 0) {
		t.Error("cells past a ragged row's end should be dug")
	}
	if !w.IsSolid(-2, 0) || !w.IsSolid(-1, 0) {
		t.Error("'#' cells in the short row should be solid")
	}
}

func TestDig(t *testing.T) {
	w := Parse("###\n#.#\n###\n")
	if !w.IsSolid(1, 0) {
		t.Fatal("precondition: (1,0) solid")
	}
	w.Dig(1, 0)
	if w.IsSolid(1, 0) {
		t.Error("dug cell should no longer be solid")
	}
	if got := len(w.DugCells()); got != 2 {
		t.Errorf("want 2 dug cells, got %d", got)
	}
	w.Dig(1, 0) // idempotent
	if got := len(w.DugCells()); got != 2 {
		t.Errorf("re-dig should be a no-op, got %d cells", got)
	}
}

func TestSpawnSpreadsOut(t *testing.T) {
	// A dug plus shape around the origin.
	w := Parse("#.#\n...\n#.#\n")
	first := w.Spawn(nil)
	if first != (Cell{0, 0}) {
		t.Fatalf("first spawn should be the origin, got %v", first)
	}
	second := w.Spawn([]Cell{first})
	if second == first {
		t.Error("second spawn must avoid the occupied cell")
	}
	if w.IsSolid(second.X, second.Z) {
		t.Errorf("spawn %v must be a dug cell", second)
	}
	if d := second.X*second.X + second.Z*second.Z; d != 1 {
		t.Errorf("second spawn should be an adjacent arm cell, got %v (d=%d)", second, d)
	}
}

func TestSpawnDeterministicTieBreak(t *testing.T) {
	w := Parse("#.#\n...\n#.#\n")
	occ := []Cell{{0, 0}}
	a, b := w.Spawn(occ), w.Spawn(occ)
	if a != b {
		t.Errorf("same inputs should give the same spawn: %v vs %v", a, b)
	}
}
