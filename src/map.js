// Load & parse the ASCII map.
//
// The world is an *infinite* plane of solid rock; the map carves holes into it.
// Inside the map, '#' = solid rock, '.'/space = a dug-out gap. Every cell
// outside the map is solid. Lines starting with ';' or blank lines are ignored;
// rows may be ragged (width = longest row).

import { FADE_RADIUS } from './config.js';

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

  // Exact Euclidean distance (in cell units) from a world point to the nearest
  // dug-out area, capped at FADE_RADIUS. Each gap fills its whole 1x1 cell, so
  // this measures to the cell's square, not its center: a point on the rim of a
  // tunnel is at distance 0. Scans only the cells within reach of the cap.
  const interiorDistance = (px, pz) => {
    let best = FADE_RADIUS;
    const reach = FADE_RADIUS + 0.5;
    for (let cz = Math.ceil(pz - reach); cz <= Math.floor(pz + reach); cz++)
      for (let cx = Math.ceil(px - reach); cx <= Math.floor(px + reach); cx++) {
        if (!dugCells.has(`${cx},${cz}`)) continue;
        const dx = Math.max(Math.abs(px - cx) - 0.5, 0);
        const dz = Math.max(Math.abs(pz - cz) - 0.5, 0);
        best = Math.min(best, Math.hypot(dx, dz));
        if (best === 0) return 0;
      }
    return best;
  };

  const isSolid = (wx, wz) => !dugCells.has(`${wx},${wz}`);
  // World-cell rectangle the map occupies (inclusive), for anyone who needs to
  // know where the carved region ends and the infinite solid rock begins.
  const bounds = {
    minX: -originX, maxX: gridW - 1 - originX,
    minZ: -originZ, maxZ: gridD - 1 - originZ,
  };
  return { isSolid, interiorDistance, bounds, gridW, gridD };
}
