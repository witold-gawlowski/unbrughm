// Other players' balls. The server streams everyone's position ~20/s; we keep
// a target per player and lerp the mesh toward it each frame so remote balls
// glide instead of teleporting between network ticks.

import * as THREE from 'three';
import { SIZE } from './config.js';
import { makeBallMesh, REST_Y } from './ball.js';

// How aggressively a remote ball chases its latest known position. High enough
// to stay within a cell of the truth at BALL_SPEED, low enough to smooth the
// ~50 ms steps between server ticks.
const LERP_RATE = 12;

export function createRemotePlayers({ scene, selfId }) {
  const players = new Map();   // id -> { mesh, target }

  // Deterministic per-id color: golden-angle hue spacing keeps consecutive
  // ids visually distinct.
  const colorFor = id => new THREE.Color(`hsl(${Math.round(id * 137.508) % 360}, 80%, 55%)`);

  function add({ id, x, z }) {
    if (id === selfId || players.has(id)) return;
    const mesh = makeBallMesh(colorFor(id));
    mesh.position.set(x * SIZE, REST_Y, z * SIZE);
    scene.add(mesh);
    players.set(id, { mesh, target: mesh.position.clone() });
  }

  function remove(id) {
    const p = players.get(id);
    if (!p) return;
    scene.remove(p.mesh);
    p.mesh.geometry.dispose();
    p.mesh.material.dispose();
    players.delete(id);
  }

  // One batched position message per server tick; ignore our own entry and
  // treat unknown ids as joins (covers a join racing ahead of its broadcast).
  function updatePositions(list) {
    for (const p of list) {
      if (p.id === selfId) continue;
      const known = players.get(p.id);
      if (!known) { add(p); continue; }
      known.target.set(p.x * SIZE, REST_Y, p.z * SIZE);
    }
  }

  function update(dt) {
    const t = Math.min(1, LERP_RATE * dt);
    for (const p of players.values()) p.mesh.position.lerp(p.target, t);
  }

  return { add, remove, updatePositions, update };
}
