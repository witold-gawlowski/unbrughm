// Digging: the core Dungeon Keeper verb. A right-click on rock walks the ball to
// an orthogonally-adjacent dug cell, waits DIG_DELAY beside the wall, then breaks
// the tile — mutating the map, re-baking the darkness field locally, and
// rebuilding the affected chunk(s).
//
// One pending dig at a time, no queue. Any *accepted* RMB command (a dig or a
// move) cancels a pending dig; ignored clicks (buried rock) leave a previous dig
// untouched.

import * as THREE from 'three';
import { SIZE, DIG_DELAY } from './config.js';
import { findPath } from './path.js';

const ORTHO = [[1, 0], [-1, 0], [0, 1], [0, -1]];

export function createDigger({ ball, map, invalidateCell, darkness }) {
  let pending = null;   // { wx, wz, remaining } — non-null only during the delay phase

  function requestDig(wx, wz) {
    if (!map.isSolid(wx, wz)) return;
    const here = ball.getCell();
    // Walk to the nearest reachable dug orthogonal neighbor (matches the cells
    // whose walls face this rock). The ball's own cell is just a length-1 path.
    let best = null;
    for (const [dx, dz] of ORTHO) {
      const c = { x: wx + dx, z: wz + dz };
      if (map.isSolid(c.x, c.z)) continue;
      const cells = findPath(map.isSolid, here, c);
      if (cells && (!best || cells.length < best.cells.length)) best = { c, cells };
    }
    if (!best) return;   // buried or unreachable: ignore, keep any previous dig

    cancel();            // accepted: drop any previous pending dig
    ball.moveTo(
      new THREE.Vector3(best.c.x * SIZE, 0, best.c.z * SIZE),
      () => { pending = { wx, wz, remaining: DIG_DELAY }; });
  }

  // Walk-phase cancel happens implicitly: the next moveTo overwrites the ball's
  // arrival callback, so the dig never arms.
  function cancel() { pending = null; }

  function update(dt) {
    if (!pending) return;
    pending.remaining -= dt;
    if (pending.remaining > 0) return;
    const { wx, wz } = pending;
    pending = null;
    map.dig(wx, wz);               // mutate first,
    darkness.updateAround(wx, wz); // then re-bake lighting,
    invalidateCell(wx, wz);        // then rebuild geometry (reads the new isSolid)
  }

  return { requestDig, cancel, update };
}
