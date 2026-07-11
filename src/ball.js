// The player's ball: a sphere resting on the tunnel floor. On a click it
// routes through the dug tunnels to the destination (A* + string-pulling in
// path.js), following the resulting straight legs at constant speed and hugging
// corners without clipping rock.

import * as THREE from 'three';
import { SIZE, BALL_RADIUS, BALL_SPEED, SHADOWS } from './config.js';
import { findPath, smoothPath } from './path.js';

// Rest height so a ball sits on the floor quad. Shared with remote.js.
export const REST_Y = -SIZE / 2 + BALL_RADIUS * SIZE;

// The one ball look, local and remote alike — only the color differs.
export function makeBallMesh(color) {
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(BALL_RADIUS * SIZE, 24, 16),
    // Not darkness-patched: balls only live inside tunnels (distance 0).
    new THREE.MeshStandardMaterial({ color, roughness: 0.4 }));
  mesh.castShadow = mesh.receiveShadow = SHADOWS;   // drops a shadow on the floor
  return mesh;
}

export function createBall({ scene, isSolid, spawn, color = 0xffffff }) {
  const mesh = makeBallMesh(color);
  mesh.position.set(spawn.x * SIZE, REST_Y, spawn.z * SIZE);   // server-assigned cell
  scene.add(mesh);

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
    for (const p of smooth) waypoints.push(new THREE.Vector3(p.x, REST_Y, p.z));
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

  return { moveTo, update, getCell, position: mesh.position };
}
