// Wire the pieces together and drive the render loop. The game is online-only:
// we connect first, and the welcome message supplies the world (dug cells),
// our identity (id, spawn) and who's already here.

import * as THREE from 'three';
import { connect } from './net.js';
import { createMap } from './map.js';
import { createView } from './view.js';
import { createChunkField } from './chunks.js';
import { createDarkness } from './darkness.js';
import { createBall } from './ball.js';
import { createRemotePlayers } from './remote.js';
import { createDigger } from './dig.js';
import { enablePanning, enableClickToMove } from './controls.js';
import { SIZE } from './config.js';

const net = await connect();
const map = createMap(net.dug);

const { scene, camera, renderer, target, updateCamera } = createView();
const darkness = createDarkness({ isSolid: map.isSolid, camera });
const ball = createBall({ scene, isSolid: map.isSolid, spawn: net.spawn });
const remote = createRemotePlayers({ scene, selfId: net.id });
for (const p of net.players) remote.add(p);

const { ensureCoverage, processBuildQueue, invalidateCell } =
  createChunkField({ scene, camera, target, isSolid: map.isSolid, darkness });

// A completed dig — ours or anyone's — is always the same trio: mutate first,
// then re-bake lighting, then rebuild geometry (reads the new isSolid).
function applyDig(wx, wz) {
  map.dig(wx, wz);
  darkness.updateAround(wx, wz);
  invalidateCell(wx, wz);
}

const digger = createDigger({
  ball,
  isSolid: map.isSolid,
  // Our own digs also go to the server, as accomplished facts.
  onDig: (wx, wz) => { applyDig(wx, wz); net.sendDig(wx, wz); },
});

net.onMessage(msg => {
  switch (msg.type) {
    case 'pos': remote.updatePositions(msg.players); break;
    case 'dig': applyDig(msg.x, msg.z); break;
    case 'join': remote.add(msg.player); break;
    case 'leave': remote.remove(msg.id); break;
  }
});

enablePanning({ renderer, camera, target, updateCamera });
enableClickToMove({
  renderer, camera, isSolid: map.isSolid,
  onGroundClick: p => { digger.cancel(); ball.moveTo(p); },
  onRockClick: (wx, wz) => digger.requestDig(wx, wz),
});

// Stream our position to the server at most ~20/s, and only when it moved.
// Wire coordinates are cell units (world / SIZE).
const SEND_INTERVAL = 1 / 20;
let sendCooldown = 0;
let lastSentX = NaN, lastSentZ = NaN;
function streamPosition(dt) {
  sendCooldown -= dt;
  if (sendCooldown > 0) return;
  const x = ball.position.x / SIZE, z = ball.position.z / SIZE;
  if (x === lastSentX && z === lastSentZ) return;
  net.sendPos(x, z);
  lastSentX = x; lastSentZ = z;
  sendCooldown = SEND_INTERVAL;
}

const clock = new THREE.Clock();
(function animate() {
  requestAnimationFrame(animate);
  const dt = clock.getDelta();
  ball.update(dt);        // advance the ball toward its destination
  remote.update(dt);      // glide remote balls toward their latest positions
  digger.update(dt);      // tick the pending dig's delay, break the tile when it lands
  streamPosition(dt);
  darkness.ensureCoverage(); // scroll the fade window with the view (same camera state)
  darkness.processBakeQueue(); // bake a few newly-exposed fade tiles this frame
  ensureCoverage();       // queue any chunks the view (plus buffer) needs
  processBuildQueue();    // build a few of them this frame
  renderer.render(scene, camera);
})();
