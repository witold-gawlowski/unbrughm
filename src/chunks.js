// On-demand chunked terrain.
//
// Each CHUNK_SIZE x CHUNK_SIZE tile is one geometry — one draw call per chunk,
// not per cube. The geometry is generated procedurally, emitting only the faces
// that can actually be seen (a solid cell's top, plus a side wall for each dug
// neighbor; a dug cell's floor). Buried faces between two solid cells and all
// bottom faces are never emitted — roughly a 6x triangle cut over full cubes,
// and no per-cube clone/merge churn, so per-chunk rebuilds are cheap. Each frame
// we figure out which chunks the camera can see (plus a buffer ring), queue any
// not yet loaded, and build only a few per frame so a fast pan never stalls.
// Chunks that scroll out of range are unloaded and their GPU geometry freed.

import * as THREE from 'three';
import { SIZE, CHUNK_SIZE, BUFFER_CHUNKS, BUILD_BUDGET, CHUNK_SPAN, SHADOWS } from './config.js';
import { visibleGroundRect } from './ground.js';

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

  // Push one quad (4 verts, 6 indices, a flat per-face normal repeated 4x) into
  // a face bucket. `corners` are listed counter-clockwise as seen from `normal`,
  // matching three.js front faces so backface culling keeps them.
  function pushQuad(bucket, normal, corners) {
    const base = bucket.pos.length / 3;
    for (const [x, y, z] of corners) {
      bucket.pos.push(x, y, z);
      bucket.norm.push(normal[0], normal[1], normal[2]);
    }
    bucket.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  function buildChunk(cx, cz) {
    // Emit only exposed faces. Rock and floor faces go to separate buckets so
    // the final geometry can map them to [rockMaterial, floorMaterial] groups.
    const h = SIZE / 2;
    const rock = { pos: [], norm: [], idx: [] };
    const floor = { pos: [], norm: [], idx: [] };

    for (let iz = 0; iz < CHUNK_SIZE; iz++) {
      for (let ix = 0; ix < CHUNK_SIZE; ix++) {
        const wx = cx * CHUNK_SIZE + ix, wz = cz * CHUNK_SIZE + iz;
        const x = wx * SIZE, z = wz * SIZE;
        if (isSolid(wx, wz)) {
          // Top cap (camera is always above the plane).
          pushQuad(rock, [0, 1, 0], [
            [x - h, h, z - h], [x - h, h, z + h], [x + h, h, z + h], [x + h, h, z - h]]);
          // A side wall for each dug-out neighbor; the global isSolid query spans
          // chunk borders and the infinite outer rock seamlessly.
          if (!isSolid(wx + 1, wz)) pushQuad(rock, [1, 0, 0], [
            [x + h, -h, z - h], [x + h, h, z - h], [x + h, h, z + h], [x + h, -h, z + h]]);
          if (!isSolid(wx - 1, wz)) pushQuad(rock, [-1, 0, 0], [
            [x - h, -h, z - h], [x - h, -h, z + h], [x - h, h, z + h], [x - h, h, z - h]]);
          if (!isSolid(wx, wz + 1)) pushQuad(rock, [0, 0, 1], [
            [x - h, -h, z + h], [x + h, -h, z + h], [x + h, h, z + h], [x - h, h, z + h]]);
          if (!isSolid(wx, wz - 1)) pushQuad(rock, [0, 0, -1], [
            [x - h, -h, z - h], [x - h, h, z - h], [x + h, h, z - h], [x + h, -h, z - h]]);
        } else {
          // Floor at the tunnel bottom, so dug cells show a walkable base.
          pushQuad(floor, [0, 1, 0], [
            [x - h, -h, z - h], [x - h, -h, z + h], [x + h, -h, z + h], [x + h, -h, z - h]]);
        }
      }
    }

    // Assemble only the non-empty buckets so material-group indices stay aligned.
    const parts = [];
    if (rock.idx.length) parts.push([rock, rockMaterial]);
    if (floor.idx.length) parts.push([floor, floorMaterial]);
    if (parts.length === 0) return null;   // every cell emits a top or a floor, so never empty

    const positions = [], normals = [], indices = [], materials = [];
    const geometry = new THREE.BufferGeometry();
    let vbase = 0;
    for (const [bucket, material] of parts) {
      const groupStart = indices.length;
      for (let i = 0; i < bucket.pos.length; i++) positions.push(bucket.pos[i]);
      for (let i = 0; i < bucket.norm.length; i++) normals.push(bucket.norm[i]);
      for (let i = 0; i < bucket.idx.length; i++) indices.push(bucket.idx[i] + vbase);
      if (parts.length > 1) geometry.addGroup(groupStart, bucket.idx.length, materials.length);
      materials.push(material);
      vbase += bucket.pos.length / 3;
    }
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(normals), 3));
    const IndexArray = vbase > 65535 ? Uint32Array : Uint16Array;
    geometry.setIndex(new THREE.BufferAttribute(new IndexArray(indices), 1));

    const mesh = new THREE.Mesh(geometry, materials.length === 1 ? materials[0] : materials);
    mesh.castShadow = mesh.receiveShadow = SHADOWS;   // walls shadow the tunnel floors
    return mesh;
  }

  // Chunk-index rectangle the camera currently sees: the visible ground rect
  // divided into chunk indices, padded by BUFFER_CHUNKS.
  function visibleChunkRect() {
    const { minX, maxX, minZ, maxZ } = visibleGroundRect(camera);
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
