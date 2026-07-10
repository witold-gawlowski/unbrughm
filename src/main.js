// Wire the pieces together and drive the render loop.

import { loadMap } from './map.js';
import { createView } from './view.js';
import { createChunkField } from './chunks.js';
import { createDarkness } from './darkness.js';
import { enablePanning } from './controls.js';

const { scene, camera, renderer, target, updateCamera } = createView();
const map = await loadMap();
const darkness = createDarkness(map);

enablePanning({ renderer, camera, target, updateCamera });
const { ensureCoverage, processBuildQueue } =
  createChunkField({ scene, camera, target, isSolid: map.isSolid, darkness });

(function animate() {
  requestAnimationFrame(animate);
  ensureCoverage();       // queue any chunks the view (plus buffer) needs
  processBuildQueue();    // build a few of them this frame
  renderer.render(scene, camera);
})();
