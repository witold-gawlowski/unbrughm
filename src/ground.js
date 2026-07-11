// Screen -> horizontal-plane unprojection, the recurring primitive across the
// renderer: take a point in the viewport and find where it lands on a plane
// y = const (the ground, y = 0, by default).
//
// Unproject the point onto the camera's near plane, then slide along the view
// direction until it hits the plane. Shared by controls.js (panning,
// click-to-move, rock picking) and chunks.js (visible-chunk corners).

import * as THREE from 'three';

// NDC point (nx, ny in [-1, 1]) -> THREE.Vector3 on the plane y = `y`.
export function planePoint(camera, nx, ny, y = 0) {
  const fwd = new THREE.Vector3();
  camera.getWorldDirection(fwd);
  const p = new THREE.Vector3(nx, ny, -1).unproject(camera);
  return p.addScaledVector(fwd, (y - p.y) / fwd.y);
}

// Client (mouse) coords -> THREE.Vector3 on the plane y = `y`.
export function planeUnderCursor(camera, canvas, clientX, clientY, y = 0) {
  const r = canvas.getBoundingClientRect();
  const nx = ((clientX - r.left) / r.width) * 2 - 1;
  const ny = -((clientY - r.top) / r.height) * 2 + 1;
  return planePoint(camera, nx, ny, y);
}

// y = 0 wrappers, so chunks.js / view.js / panning stay untouched.
export const groundPoint = (camera, nx, ny) => planePoint(camera, nx, ny, 0);
export const groundUnderCursor = (camera, canvas, clientX, clientY) =>
  planeUnderCursor(camera, canvas, clientX, clientY, 0);

// World-space axis-aligned rect the viewport covers on the ground (y = 0),
// found by projecting the four viewport corners down onto the plane. Shared by
// chunks.js (which chunks to stream) and darkness.js (which fade window to bake).
export function visibleGroundRect(camera) {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const [nx, ny] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    const p = groundPoint(camera, nx, ny);   // this viewport corner on y = 0
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
  }
  return { minX, maxX, minZ, maxZ };
}
