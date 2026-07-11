// Mouse controls: left-mouse-drag panning and right-click-to-move.

import { SIZE } from './config.js';
import { groundUnderCursor, planeUnderCursor } from './ground.js';

// Left-mouse-drag panning.
//
// Grab the ground point under the cursor and keep it there: convert both mouse
// samples to points on y = 0 and shift `target` by the difference.
export function enablePanning({ renderer, camera, target, updateCamera }) {
  const canvas = renderer.domElement;

  let grabbed = null;   // world point the LMB grabbed, held under the cursor
  canvas.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;                 // left button only
    grabbed = groundUnderCursor(camera, canvas, e.clientX, e.clientY);
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', e => {
    if (!grabbed) return;
    const cur = groundUnderCursor(camera, canvas, e.clientX, e.clientY);
    target.add(grabbed.clone().sub(cur));       // move so `grabbed` returns under cursor
    updateCamera();
  });
  const endPan = () => { grabbed = null; };
  canvas.addEventListener('pointerup', endPan);
  canvas.addEventListener('pointercancel', endPan);
}

// Right-click dispatcher: one "command" button, disambiguated by what's under
// the cursor. Rock cubes span y in [-SIZE/2, +SIZE/2], so pick analytically
// instead of raycasting the (private) chunk meshes: unproject the cursor onto
// the rock-top plane and the floor plane, then march that short segment
// top -> bottom, nearest-to-camera first. The first solid cell hit is the
// clicked rock (catching top *and* side faces); no solid hit means a floor
// click at the bottom point, which is guaranteed non-solid.
export function enableClickToMove({ renderer, camera, isSolid, onGroundClick, onRockClick }) {
  const canvas = renderer.domElement;
  canvas.addEventListener('contextmenu', e => e.preventDefault());
  canvas.addEventListener('pointerdown', e => {
    if (e.button !== 2) return;                 // right button only
    const top = planeUnderCursor(camera, canvas, e.clientX, e.clientY, SIZE / 2);
    const bottom = planeUnderCursor(camera, canvas, e.clientX, e.clientY, -SIZE / 2);
    for (let i = 0; i <= 8; i++) {              // march top -> bottom
      const t = i / 8;
      const cx = Math.round((top.x + (bottom.x - top.x) * t) / SIZE);
      const cz = Math.round((top.z + (bottom.z - top.z) * t) / SIZE);
      if (isSolid(cx, cz)) { onRockClick(cx, cz); return; }
    }
    onGroundClick(bottom);   // floor click; the y = -SIZE/2 point also fixes the old half-cell parallax
  });
}
