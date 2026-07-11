// World geometry: an *infinite* plane of solid rock with holes carved into it.
// The set of dug-out cells arrives from the server in the welcome message
// (initial map gaps plus every dig so far); the server parses dungeon.txt now.

export function createMap(dugCells) {
  const dug = new Set(dugCells.map(([wx, wz]) => `${wx},${wz}`));

  const isSolid = (wx, wz) => !dug.has(`${wx},${wz}`);
  // Carve out a cell. isSolid closes over dug, so pathfinding and the
  // isSolid-seeded darkness bake see the change instantly.
  const dig = (wx, wz) => { dug.add(`${wx},${wz}`); };

  return { isSolid, dig };
}
