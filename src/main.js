// Wire the pieces together and drive the render loop.

import * as THREE from 'three';
import { loadMap } from './map.js';
import { createView } from './view.js';
import { createChunkField } from './chunks.js';
import { createDarkness } from './darkness.js';
import { createBall } from './ball.js';
import { enablePanning, enableClickToMove } from './controls.js';

const { scene, camera, renderer, target, updateCamera } = createView();
const map = await loadMap();
const darkness = createDarkness({ isSolid: map.isSolid, camera });
const ball = createBall({ scene, isSolid: map.isSolid, bounds: map.bounds });

enablePanning({ renderer, camera, target, updateCamera });
enableClickToMove({ renderer, camera, isSolid: map.isSolid, onGroundClick: ball.moveTo });
const { ensureCoverage, processBuildQueue } =
  createChunkField({ scene, camera, target, isSolid: map.isSolid, darkness });

const clock = new THREE.Clock();
(function animate() {
  requestAnimationFrame(animate);
  ball.update(clock.getDelta());   // advance the ball toward its destination
  darkness.ensureCoverage(); // scroll the fade window with the view (same camera state)
  darkness.processBakeQueue(); // bake a few newly-exposed fade tiles this frame
  ensureCoverage();       // queue any chunks the view (plus buffer) needs
  processBuildQueue();    // build a few of them this frame
  renderer.render(scene, camera);
})();
