// Load & parse the ASCII map.
//
// The world is an *infinite* plane of solid rock; the map carves holes into it.
// Inside the map, '#' = solid rock, '.'/space = a dug-out gap. Every cell
// outside the map is solid. Lines starting with ';' or blank lines are ignored;
// rows may be ragged (width = longest row).

export async function loadMap(url = 'dungeon.txt') {
  const raw = await fetch(url).then(r => r.text());
  const rows = raw.split('\n')
    .map(l => l.replace(/\r$/, ''))
    .filter(l => l.trim() !== '' && !l.startsWith(';'));
  const gridW = Math.max(...rows.map(r => r.length));
  const gridD = rows.length;

  // Anchor the map on integer world-cell coordinates (centered on the origin)
  // so chunks tile cleanly. A cell is solid unless it's a dug gap, and gaps are
  // only the non-'#' cells that fall inside the map bounds.
  const originX = Math.floor(gridW / 2);
  const originZ = Math.floor(gridD / 2);
  const dugCells = new Set();               // "wx,wz" of carved-out holes
  for (let row = 0; row < gridD; row++)
    for (let col = 0; col < gridW; col++)
      if ((rows[row][col] ?? '') !== '#')
        dugCells.add(`${col - originX},${row - originZ}`);

  const isSolid = (wx, wz) => !dugCells.has(`${wx},${wz}`);
  // World-cell rectangle the map occupies (inclusive), for anyone who needs to
  // know where the carved region ends and the infinite solid rock begins.
  const bounds = {
    minX: -originX, maxX: gridW - 1 - originX,
    minZ: -originZ, maxZ: gridD - 1 - originZ,
  };
  return { isSolid, bounds, gridW, gridD };
}
