// The player's ball: a white sphere resting on the tunnel floor. On a click it
// routes through the dug tunnels to the destination (A* + string-pulling in
// path.js), following the resulting straight legs at constant speed and hugging
// corners without clipping rock.

import * as THREE from 'three';
import { SIZE, BALL_RADIUS, BALL_SPEED, SHADOWS } from './config.js';
import { findPath, smoothPath } from './path.js';

export function createBall({ scene, isSolid, bounds }) {
  const restY = -SIZE / 2 + BALL_RADIUS * SIZE;   // sit on the floor quad

  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(BALL_RADIUS * SIZE, 24, 16),
    // Not darkness-patched: the ball only lives inside tunnels (distance 0).
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 }));
  mesh.castShadow = mesh.receiveShadow = SHADOWS;   // drops a shadow on the floor
  mesh.position.set(0, restY, 0);
  scene.add(mesh);

  // Spawn on the dug cell nearest the origin.
  const spawn = nearestDugCell(isSolid, bounds);
  mesh.position.set(spawn.x * SIZE, restY, spawn.z * SIZE);

  const waypoints = [];   // remaining straight legs; the ball heads for [0]
  let arrivalCb = null;   // fired once when the ball finishes its current route

  // Plan a route from where the ball stands to the clicked point. Unreachable
  // clicks (sealed pockets) leave the current path untouched. `onArrive`, if
  // given, fires when this route completes; issuing any move overwrites it
  // (clearing a stale callback), even on the unreachable early return.
  function moveTo(point, onArrive) {
    arrivalCb = onArrive ?? null;
    const start = { x: Math.round(mesh.position.x / SIZE), z: Math.round(mesh.position.z / SIZE) };
    const goal = { x: Math.round(point.x / SIZE), z: Math.round(point.z / SIZE) };
    const cells = findPath(isSolid, start, goal);
    if (!cells) return;

    // Cell centres, but pin the endpoints to the real start/click positions so
    // the ball doesn't snap to a grid centre at either end.
    const pts = cells.map(c => ({ x: c.x * SIZE, z: c.z * SIZE }));
    pts[0] = { x: mesh.position.x, z: mesh.position.z };
    pts[pts.length - 1] = { x: point.x, z: point.z };

    const smooth = smoothPath(isSolid, pts, BALL_RADIUS * SIZE);
    waypoints.length = 0;
    for (const p of smooth) waypoints.push(new THREE.Vector3(p.x, restY, p.z));
  }

  // Glide toward waypoints[0] at constant speed, spilling any leftover distance
  // into the next leg so corners don't slow the ball down.
  function update(dt) {
    let step = BALL_SPEED * SIZE * dt;
    while (step > 0 && waypoints.length) {
      const to = waypoints[0].clone().sub(mesh.position);
      to.y = 0;
      const dist = to.length();
      if (dist < 1e-4) { waypoints.shift(); continue; }
      if (step >= dist) {
        mesh.position.copy(waypoints.shift());
        step -= dist;
      } else {
        mesh.position.addScaledVector(to.divideScalar(dist), step);
        step = 0;
      }
    }
    // Arrived: fire the callback once. Snapshot and clear first so a moveTo
    // issued from inside the callback keeps its fresh callback.
    if (arrivalCb && waypoints.length === 0) {
      const cb = arrivalCb;
      arrivalCb = null;
      cb();
    }
  }

  function getCell() {
    return { x: Math.round(mesh.position.x / SIZE), z: Math.round(mesh.position.z / SIZE) };
  }

  return { moveTo, update, getCell };
}

// Scan the map bounds for the dug (!isSolid) cell closest to (0, 0).
function nearestDugCell(isSolid, bounds) {
  let best = { x: 0, z: 0 }, bestD = Infinity;
  for (let z = bounds.minZ; z <= bounds.maxZ; z++)
    for (let x = bounds.minX; x <= bounds.maxX; x++) {
      if (isSolid(x, z)) continue;
      const d = x * x + z * z;
      if (d < bestD) { bestD = d; best = { x, z }; }
    }
  return best;
}
