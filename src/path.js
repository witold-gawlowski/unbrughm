// Pathfinding for the ball: route around solid rock through the dug tunnels.
//
// Cells are integer world coordinates (world position = cell * SIZE), the same
// convention as map.js. `findPath` runs A* over dug cells; `smoothPath` then
// string-pulls the tile-by-tile route into a few straight legs using
// `hasLineOfSight`, which respects the ball's radius so it hugs corners without
// clipping rock.

import { SIZE } from './config.js';

// 8-connected neighbours: orthogonals cost 1, diagonals cost √2.
const DIRS = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [1, 1], [1, -1], [-1, 1], [-1, -1],
];

const key = (x, z) => `${x},${z}`;

// Octile distance: exact cost of an unobstructed 8-directional walk.
function octile(a, b) {
  const dx = Math.abs(a.x - b.x), dz = Math.abs(a.z - b.z);
  return (dx + dz) + (Math.SQRT2 - 2) * Math.min(dx, dz);
}

// A* over dug (!isSolid) cells. `start` and `goal` are integer cells. Returns an
// array of {x, z} cells from start to goal, or null if the goal is unreachable
// (sealed-off pocket) or either endpoint is solid. Diagonal moves are forbidden
// when either flanking orthogonal cell is solid, so the path never cuts a corner
// through rock. A linear-scan open list is plenty at this map size.
export function findPath(isSolid, start, goal) {
  if (isSolid(start.x, start.z) || isSolid(goal.x, goal.z)) return null;
  const startK = key(start.x, start.z), goalK = key(goal.x, goal.z);

  const g = new Map([[startK, 0]]);
  const came = new Map();
  const open = new Map([[startK, { x: start.x, z: start.z, f: octile(start, goal) }]]);

  while (open.size) {
    let bestK = null, best = null;                // pop the lowest-f node
    for (const [k, n] of open) if (!best || n.f < best.f) { bestK = k; best = n; }
    if (bestK === goalK) return reconstruct(came, goalK);
    open.delete(bestK);

    const gc = g.get(bestK);
    for (const [dx, dz] of DIRS) {
      const nx = best.x + dx, nz = best.z + dz;
      if (isSolid(nx, nz)) continue;
      const diagonal = dx !== 0 && dz !== 0;
      if (diagonal && (isSolid(best.x + dx, best.z) || isSolid(best.x, best.z + dz)))
        continue;                                 // no corner cutting past rock
      const nk = key(nx, nz);
      const ng = gc + (diagonal ? Math.SQRT2 : 1);
      if (!g.has(nk) || ng < g.get(nk)) {
        g.set(nk, ng);
        came.set(nk, bestK);
        open.set(nk, { x: nx, z: nz, f: ng + octile({ x: nx, z: nz }, goal) });
      }
    }
  }
  return null;                                    // exhausted the reachable region
}

function reconstruct(came, goalK) {
  const cells = [];
  for (let k = goalK; k !== undefined; k = came.get(k)) {
    const [x, z] = k.split(',').map(Number);
    cells.push({ x, z });
  }
  return cells.reverse();
}

// Can a disc of `radius` (world units) slide along the world-space segment a→b
// without any part of it touching a solid cell? Samples the segment finely and,
// at each sample, measures the distance from the disc centre to every nearby
// solid cell's 1x1 square (the same max(|p−c|−0.5, 0) box-distance as
// interiorDistance in map.js). If any square is within `radius`, the leg is
// blocked.
export function hasLineOfSight(isSolid, a, b, radius) {
  const dx = b.x - a.x, dz = b.z - a.z;
  const len = Math.hypot(dx, dz);
  const r = radius / SIZE;                        // work in cell units
  const steps = Math.max(1, Math.ceil(len / (0.2 * SIZE)));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const u = (a.x + dx * t) / SIZE;
    const v = (a.z + dz * t) / SIZE;
    // Only cells whose square could sit within `r` of the point can overlap.
    for (let cz = Math.ceil(v - 0.5 - r); cz <= Math.floor(v + 0.5 + r); cz++)
      for (let cx = Math.ceil(u - 0.5 - r); cx <= Math.floor(u + 0.5 + r); cx++) {
        if (!isSolid(cx, cz)) continue;
        const bx = Math.max(Math.abs(u - cx) - 0.5, 0);
        const bz = Math.max(Math.abs(v - cz) - 0.5, 0);
        if (Math.hypot(bx, bz) < r) return false;
      }
  }
  return true;
}

// Greedy string-pulling: walk from the current anchor, keep the farthest later
// waypoint still reachable in a straight line, drop everything between them, and
// repeat. Turns the dense cell path into a handful of straight legs that hug
// corners. `points` are world-space {x, z}.
export function smoothPath(isSolid, points, radius) {
  if (points.length <= 2) return points.slice();
  const out = [points[0]];
  let anchor = 0;
  while (anchor < points.length - 1) {
    let next = anchor + 1;
    for (let j = points.length - 1; j > anchor; j--)
      if (hasLineOfSight(isSolid, points[anchor], points[j], radius)) { next = j; break; }
    out.push(points[next]);
    anchor = next;
  }
  return out;
}
