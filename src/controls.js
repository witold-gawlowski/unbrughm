// Right-mouse-drag panning.
//
// Grab the ground point under the cursor and keep it there: convert both mouse
// samples to points on y = 0 and shift `target` by the difference.

import * as THREE from 'three';

export function enablePanning({ renderer, camera, target, updateCamera }) {
  const canvas = renderer.domElement;
  canvas.addEventListener('contextmenu', e => e.preventDefault());

  function groundUnderCursor(clientX, clientY) {
    const r = canvas.getBoundingClientRect();
    const nx = ((clientX - r.left) / r.width) * 2 - 1;
    const ny = -((clientY - r.top) / r.height) * 2 + 1;
    const fwd = new THREE.Vector3();
    camera.getWorldDirection(fwd);
    const p = new THREE.Vector3(nx, ny, -1).unproject(camera);
    return p.addScaledVector(fwd, -p.y / fwd.y);
  }

  let grabbed = null;   // world point the RMB grabbed, held under the cursor
  canvas.addEventListener('pointerdown', e => {
    if (e.button !== 2) return;                 // right button only
    grabbed = groundUnderCursor(e.clientX, e.clientY);
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', e => {
    if (!grabbed) return;
    const cur = groundUnderCursor(e.clientX, e.clientY);
    target.add(grabbed.clone().sub(cur));       // move so `grabbed` returns under cursor
    updateCamera();
  });
  const endPan = () => { grabbed = null; };
  canvas.addEventListener('pointerup', endPan);
  canvas.addEventListener('pointercancel', endPan);
}
