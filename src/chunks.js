// On-demand chunked terrain.
//
// Instead of one mesh per cube we merge each CHUNK_SIZE x CHUNK_SIZE tile into a
// single geometry: one draw call per chunk, not per cube. Each frame we figure
// out which chunks the camera can see (plus a buffer ring), queue any not yet
// loaded, and build only a few per frame so a fast pan never stalls. Chunks that
// scroll out of range are unloaded and their GPU geometry freed.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { SIZE, CHUNK_SIZE, BUFFER_CHUNKS, BUILD_BUDGET, CHUNK_SPAN, SHADOWS } from './config.js';
import { groundPoint } from './ground.js';

// Suppress direct (sun) light on up-facing fragments, so cube tops are lit only
// by the hemisphere fill. Wraps whatever onBeforeCompile the material already has
// (darkness.js) rather than replacing it.
function unlitTops(material) {
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader) => {
    if (prev) prev(shader);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vUpness;')
      .replace('#include <begin_vertex>',
        '#include <begin_vertex>\nvUpness = (modelMatrix * vec4(normal, 0.0)).y;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vUpness;')
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
if (vUpness > 0.5) { reflectedLight.directDiffuse = vec3(0.0); reflectedLight.directSpecular = vec3(0.0); }`);
  };
  return material;
}

export function createChunkField({ scene, camera, target, isSolid, darkness }) {
  const cubeGeometry = new THREE.BoxGeometry(SIZE, SIZE, SIZE);
  // A floor quad laid flat at the bottom of the tunnels (y = -SIZE/2), so dug-out
  // cells show a walkable base instead of the background void. Built once and
  // cloned per cell, mirroring cubeGeometry.
  const floorGeometry = new THREE.PlaneGeometry(SIZE, SIZE);
  floorGeometry.rotateX(-Math.PI / 2);
  floorGeometry.translate(0, -SIZE / 2, 0);

  // darkness patches the materials so rock fades per fragment with distance
  // from the tunnels (see darkness.js); floors are interior and stay lit.
  const rockMaterial = unlitTops(darkness.applyTo(
    new THREE.MeshStandardMaterial({ color: 0x232a32, roughness: 0.85 })));
  const floorMaterial = darkness.applyTo(
    new THREE.MeshStandardMaterial({ color: 0x3a4450, roughness: 0.95 }));

  const loaded = new Map();   // "cx,cz" -> mesh | null   (built chunks)
  const pending = new Set();  // "cx,cz" queued but not built yet
  const queue = [];           // [{ cx, cz, key }] build queue, nearest-first
  const keyOf = (cx, cz) => `${cx},${cz}`;

  function buildChunk(cx, cz) {
    // Solid cells get a rock cube; dug-out cells get a floor quad. The two sets
    // are merged separately, then combined into one geometry whose material
    // groups pick rock vs floor per face.
    const rockGeoms = [], floorGeoms = [];
    for (let iz = 0; iz < CHUNK_SIZE; iz++) {
      for (let ix = 0; ix < CHUNK_SIZE; ix++) {
        const wx = cx * CHUNK_SIZE + ix, wz = cz * CHUNK_SIZE + iz;
        const g = (isSolid(wx, wz) ? cubeGeometry : floorGeometry).clone();
        g.translate(wx * SIZE, 0, wz * SIZE);
        (isSolid(wx, wz) ? rockGeoms : floorGeoms).push(g);
      }
    }
    // Assemble only the non-empty parts so material-group indices stay aligned.
    const parts = [], materials = [];
    if (rockGeoms.length) { parts.push(mergeGeometries(rockGeoms)); materials.push(rockMaterial); }
    if (floorGeoms.length) { parts.push(mergeGeometries(floorGeoms)); materials.push(floorMaterial); }
    [...rockGeoms, ...floorGeoms].forEach(g => g.dispose());
    if (parts.length === 0) return null;
    const geometry = parts.length === 1 ? parts[0] : mergeGeometries(parts, true);
    parts.forEach(p => { if (p !== geometry) p.dispose(); });
    const mesh = new THREE.Mesh(geometry, materials.length === 1 ? materials[0] : materials);
    mesh.castShadow = mesh.receiveShadow = SHADOWS;   // walls shadow the tunnel floors
    return mesh;
  }

  // Chunk-index rectangle the camera currently sees, found by projecting the
  // four viewport corners onto the ground (y = 0), padded by BUFFER_CHUNKS.
  function visibleChunkRect() {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const [nx, ny] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const p = groundPoint(camera, nx, ny);   // this viewport corner on y = 0
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
    }
    return {
      minCx: Math.floor(minX / CHUNK_SPAN) - BUFFER_CHUNKS,
      maxCx: Math.floor(maxX / CHUNK_SPAN) + BUFFER_CHUNKS,
      minCz: Math.floor(minZ / CHUNK_SPAN) - BUFFER_CHUNKS,
      maxCz: Math.floor(maxZ / CHUNK_SPAN) + BUFFER_CHUNKS,
    };
  }

  function ensureCoverage() {
    const { minCx, maxCx, minCz, maxCz } = visibleChunkRect();
    const want = new Set();
    for (let cz = minCz; cz <= maxCz; cz++)
      for (let cx = minCx; cx <= maxCx; cx++) {
        const key = keyOf(cx, cz);
        want.add(key);
        if (loaded.has(key) || pending.has(key)) continue;
        pending.add(key);
        queue.push({ cx, cz, key });
      }
    // unload chunks that scrolled out of range (free their GPU geometry)
    for (const [key, mesh] of loaded) {
      if (want.has(key)) continue;
      if (mesh) { scene.remove(mesh); mesh.geometry.dispose(); }
      loaded.delete(key);
    }
    // drop queued-but-unbuilt chunks that are no longer wanted
    for (let i = queue.length - 1; i >= 0; i--)
      if (!want.has(queue[i].key)) { pending.delete(queue[i].key); queue.splice(i, 1); }
    // build the chunks nearest the view centre first
    const fcx = target.x / CHUNK_SPAN, fcz = target.z / CHUNK_SPAN;
    queue.sort((a, b) =>
      (a.cx - fcx) ** 2 + (a.cz - fcz) ** 2 - ((b.cx - fcx) ** 2 + (b.cz - fcz) ** 2));
  }

  function processBuildQueue() {
    for (let n = 0; n < BUILD_BUDGET && queue.length; n++) {
      const { cx, cz, key } = queue.shift();
      pending.delete(key);
      const mesh = buildChunk(cx, cz);
      loaded.set(key, mesh);
      if (mesh) scene.add(mesh);
    }
  }

  return { ensureCoverage, processBuildQueue };
}
