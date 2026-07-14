// Package world holds the shared dungeon state: an infinite plane of solid
// rock with a set of dug-out cells carved into it. The ASCII map seeds the
// initial holes; digs at runtime only ever add to the set.
//
// Parsing must mirror the client's original map.js rules exactly, since the
// dug-cell list we send in the welcome message replaces the client's own
// parse: lines starting with ';' and blank lines are ignored, rows may be
// ragged (grid width = longest row), any non-'#' cell inside the grid bounds
// is dug (including cells past a short row's end), and the grid is centered
// on the origin at (floor(w/2), floor(d/2)).
package world

import "strings"

// Cell is an integer world-cell coordinate.
type Cell struct {
	X int
	Z int
}

// World is not safe for concurrent use; the hub goroutine owns it.
type World struct {
	dug map[Cell]bool
}

// Parse builds a World from the ASCII map text.
func Parse(raw string) *World {
	var rows []string
	for _, line := range strings.Split(raw, "\n") {
		line = strings.TrimSuffix(line, "\r")
		if strings.TrimSpace(line) == "" || strings.HasPrefix(line, ";") {
			continue
		}
		rows = append(rows, line)
	}
	gridW := 0
	for _, r := range rows {
		if len(r) > gridW {
			gridW = len(r)
		}
	}
	originX, originZ := gridW/2, len(rows)/2

	dug := make(map[Cell]bool)
	for row, line := range rows {
		for col := 0; col < gridW; col++ {
			// Past a ragged row's end counts as dug, like the client's
			// (rows[row][col] ?? '') !== '#'.
			if col < len(line) && line[col] == '#' {
				continue
			}
			dug[Cell{col - originX, row - originZ}] = true
		}
	}
	return &World{dug: dug}
}

// IsSolid reports whether the cell is rock (anything not dug).
func (w *World) IsSolid(x, z int) bool {
	return !w.dug[Cell{x, z}]
}

// Dig carves out a cell. Digging an already-dug cell is a no-op.
func (w *World) Dig(x, z int) {
	w.dug[Cell{x, z}] = true
}

// DugCells returns every dug cell (map gaps plus accumulated digs) in
// unspecified order, for the welcome message.
func (w *World) DugCells() []Cell {
	cells := make([]Cell, 0, len(w.dug))
	for c := range w.dug {
		cells = append(cells, c)
	}
	return cells
}

// Spawn picks the dug cell nearest the origin that no current player occupies,
// so joining players spread out instead of stacking. Ties break on (X, Z) to
// keep the choice deterministic. Falls back to the origin if every dug cell is
// occupied (more players than floor — a prototype non-concern).
func (w *World) Spawn(occupied []Cell) Cell {
	taken := make(map[Cell]bool, len(occupied))
	for _, c := range occupied {
		taken[c] = true
	}
	best, bestD, found := Cell{}, 0, false
	for c := range w.dug {
		if taken[c] {
			continue
		}
		d := c.X*c.X + c.Z*c.Z
		if !found || d < bestD ||
			(d == bestD && (c.X < best.X || (c.X == best.X && c.Z < best.Z))) {
			best, bestD, found = c, d, true
		}
	}
	return best
}
