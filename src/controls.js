// Mouse controls: left-mouse-drag panning and right-click-to-move.

import { SIZE } from './config.js';
import { groundUnderCursor } from './ground.js';

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

// Right-click to move the ball. Picking is against the y = 0 ground plane, not
// the meshes: a click on a rock cube's face unprojects to a cell that is
// (almost always) solid and is ignored, so only dug-out floor clicks move.
export function enableClickToMove({ renderer, camera, isSolid, onGroundClick }) {
  const canvas = renderer.domElement;
  canvas.addEventListener('contextmenu', e => e.preventDefault());
  canvas.addEventListener('pointerdown', e => {
    if (e.button !== 2) return;                 // right button only
    const p = groundUnderCursor(camera, canvas, e.clientX, e.clientY);
    const cx = Math.round(p.x / SIZE), cz = Math.round(p.z / SIZE);
    if (!isSolid(cx, cz)) onGroundClick(p);
  });
}
