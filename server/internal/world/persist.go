package world

import (
	"bufio"
	"errors"
	"fmt"
	"os"
	"sort"
)

// Save writes the world's dug cells to path so a later run can restore them.
// The format is one "x z" pair per line, sorted by (X, Z) for stable diffs.
// It writes to a temp file and renames onto path, so a crash mid-write can't
// corrupt an existing save.
func (w *World) Save(path string) error {
	cells := w.DugCells()
	sort.Slice(cells, func(i, j int) bool {
		if cells[i].X != cells[j].X {
			return cells[i].X < cells[j].X
		}
		return cells[i].Z < cells[j].Z
	})

	tmp := path + ".tmp"
	f, err := os.Create(tmp)
	if err != nil {
		return err
	}
	buf := bufio.NewWriter(f)
	for _, c := range cells {
		if _, err := fmt.Fprintf(buf, "%d %d\n", c.X, c.Z); err != nil {
			f.Close()
			return err
		}
	}
	if err := buf.Flush(); err != nil {
		f.Close()
		return err
	}
	if err := f.Close(); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

// Load rebuilds a World from a save file written by Save. When the file does
// not exist it returns ok=false so the caller can seed from the ASCII map
// instead; a malformed line is a hard error.
func Load(path string) (w *World, ok bool, err error) {
	f, err := os.Open(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, err
	}
	defer f.Close()

	dug := make(map[Cell]bool)
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		var c Cell
		if _, err := fmt.Sscanf(sc.Text(), "%d %d", &c.X, &c.Z); err != nil {
			return nil, false, fmt.Errorf("parsing save line %q: %w", sc.Text(), err)
		}
		dug[c] = true
	}
	if err := sc.Err(); err != nil {
		return nil, false, err
	}
	return &World{dug: dug}, true, nil
}
