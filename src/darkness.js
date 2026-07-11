// Pixel-precise darkness: rock fades with the true Euclidean distance to the
// nearest dug-out area, evaluated per fragment.
//
// The fade is a distance field (FADE_RESOLUTION texels per cell) baked into a
// small DataTexture by a two-pass exact Euclidean distance transform (a
// horizontal 1D sweep, then a Felzenszwalb-Huttenlocher lower-envelope column
// scan) seeded straight from isSolid — one lookup per cell, not per texel. A
// shader patch on the terrain materials samples the field with bilinear
// filtering at each fragment's world position and dims the diffuse color, so the
// gradient is continuous within faces, across cubes and chunks, independent of
// geometry.
//
// The world is infinite and the player digs anywhere, so the field cannot cover
// the whole dug region — that texture would grow without bound. Instead it's a
// fixed-size *window that follows the camera*, mirroring how chunks.js streams
// geometry: the window always covers the visible ground rect + the BUFFER_CHUNKS
// ring chunks may load + a FADE_RADIUS apron. Only fragments of loaded chunks
// ever sample the field, and loaded chunks live inside that rect, so lighting is
// correct everywhere it's actually rendered — arbitrarily far from the origin —
// while memory stays constant. Distance is capped at FADE_RADIUS, so the apron's
// edge texels are already fully dark and clamped sampling extends them correctly.
//
// ensureCoverage() re-centers the window only when panning pushes the required
// rect out of it (no per-frame cost while stationary). A re-center blits the
// overlap and *queues* the newly-exposed stripes as bake tiles; processBakeQueue()
// bakes at most FADE_BAKE_BUDGET tiles per frame, the same time-slicing chunks.js
// uses so a fast pan or resize never stalls a frame — freshly exposed rock starts
// dark and fades in over a few frames, just like chunks popping in.

import * as THREE from 'three';
import { SIZE, CHUNK_SIZE, BUFFER_CHUNKS, FADE_RADIUS, MIN_BRIGHTNESS, FADE_RESOLUTION, FADE_BAKE_BUDGET } from './config.js';
import { visibleGroundRect } from './ground.js';

// Hysteresis: cells of slack placed around the required rect at each re-center,
// so panning re-bakes only every ~MARGIN cells instead of every frame.
const MARGIN = 8;

// Bake tiles cover at most this many cells per side, so one tile is a bounded
// slab of pure array math regardless of how far the view jumped.
const TILE_CELLS = 32;

export function createDarkness({ isSolid, camera }) {
  // Window state, all mutable — the field is a fixed-size rect that follows the
  // camera. Origin (minX, minZ) is in world-cell units, snapped to whole cells
  // so the texel grid stays cell-aligned across re-centers; (w, h) are texel
  // dimensions; data is the byte-per-texel distance field bound to fadeMap.
  let minX = 0, minZ = 0, w = 0, h = 0, data = null, fadeMap = null;

  // Pending bake tiles, in *global* texel coordinates (g = cell * FADE_RESOLUTION
  // + t; stable across re-centers because the origin snaps to whole cells).
  const bakeQueue = [];

  // Scratch buffers for the distance transform, grown on demand and reused across
  // bakes: G holds the expanded region (1D row distances -> reused as input to the
  // column scan); colF/vbuf/zbuf are the per-column parabola envelope.
  let Gbuf = new Int32Array(0);
  let colF = new Float64Array(0), vbuf = new Int32Array(0), zbuf = new Float64Array(0);

  // Shared across all patched materials; the world-space rect the texture covers.
  const uniforms = {
    uFadeMap: { value: null },
    uFadeOrigin: { value: new THREE.Vector2() },
    uFadeSpan: { value: new THREE.Vector2() },
    uMinBrightness: { value: MIN_BRIGHTNESS },
  };

  // Bake the fade bytes for the global-texel rect [gx0, gx1] x [gz0, gz1]
  // (inclusive) into `data`, via a seeded two-pass exact Euclidean distance
  // transform. The rect must lie inside the current window (callers clamp it);
  // seeding reads isSolid, so an apron of dug cells just *outside* the rect is
  // still seen.
  function bakeRegion(gx0, gz0, gx1, gz1) {
    const R = FADE_RESOLUTION;
    const A = FADE_RADIUS * R;   // apron in texels: reach of the fade
    const CAP = A + 1;           // row distances past this land beyond FADE_RADIUS

    // Expand by the apron so seeds within reach of the written rect are seen.
    const ex0 = gx0 - A, ez0 = gz0 - A;
    const ex1 = gx1 + A, ez1 = gz1 + A;
    const ew = ex1 - ex0 + 1, eh = ez1 - ez0 + 1;
    if (Gbuf.length < ew * eh) Gbuf = new Int32Array(ew * eh);
    if (colF.length < eh) {
      colF = new Float64Array(eh); vbuf = new Int32Array(eh); zbuf = new Float64Array(eh + 1);
    }
    const G = Gbuf;
    G.fill(1, 0, ew * eh);   // 0 marks a seed; anything non-zero is unset

    // Seed: one isSolid() per cell covering the expanded region; a dug cell writes
    // 0 across the FADE_RESOLUTION texels whose centres fall inside its 1x1 square.
    // Cell C is centred on integer coord C (square [C-0.5, C+0.5]), so a texel g
    // (world centre (g+0.5)/R) belongs to it iff g is in [C*R - R/2, C*R + R/2 - 1]
    // — a half-cell shift from C*R, integer-aligned since R is even.
    const H = R / 2;
    const cxLo = Math.floor((ex0 + H) / R), cxHi = Math.floor((ex1 + H) / R);
    const czLo = Math.floor((ez0 + H) / R), czHi = Math.floor((ez1 + H) / R);
    for (let cz = czLo; cz <= czHi; cz++) {
      const bz0 = Math.max(cz * R - H, ez0) - ez0, bz1 = Math.min(cz * R + H - 1, ez1) - ez0;
      for (let cx = cxLo; cx <= cxHi; cx++) {
        if (isSolid(cx, cz)) continue;
        const bx0 = Math.max(cx * R - H, ex0) - ex0, bx1 = Math.min(cx * R + H - 1, ex1) - ex0;
        for (let lz = bz0; lz <= bz1; lz++) {
          const rowBase = lz * ew;
          for (let lx = bx0; lx <= bx1; lx++) G[rowBase + lx] = 0;
        }
      }
    }

    // Pass 1 — rows: two linear sweeps turn each row into the exact 1D texel
    // distance to the nearest seed in that row, capped at CAP.
    for (let z = 0; z < eh; z++) {
      const rowBase = z * ew;
      let d = CAP;
      for (let x = 0; x < ew; x++) {
        const i = rowBase + x;
        if (G[i] === 0) d = 0; else if (d < CAP) d++;
        G[i] = d;
      }
      d = CAP;
      for (let x = ew - 1; x >= 0; x--) {
        const i = rowBase + x;
        if (G[i] === 0) d = 0; else if (d < CAP) d++;
        if (d < G[i]) G[i] = d;
      }
    }

    // Pass 2 — columns: Felzenszwalb lower-envelope-of-parabolas over each inner
    // column gives exact squared 2D distance D = min_z' ((z-z')^2 + G(z')^2). Only
    // inner columns/rows are written; the apron rows still feed the envelope.
    const scale = 255 / FADE_RADIUS;
    const iz0 = gz0 - ez0, izN = gz1 - ez0;   // inner row band (local z)
    const baseX = minX * R, baseZ = minZ * R;
    for (let gx = gx0; gx <= gx1; gx++) {
      const lx = gx - ex0;
      for (let z = 0; z < eh; z++) { const g = G[z * ew + lx]; colF[z] = g * g; }
      // build the lower envelope
      let k = 0;
      vbuf[0] = 0; zbuf[0] = -Infinity; zbuf[1] = Infinity;
      for (let q = 1; q < eh; q++) {
        let s = ((colF[q] + q * q) - (colF[vbuf[k]] + vbuf[k] * vbuf[k])) / (2 * q - 2 * vbuf[k]);
        while (s <= zbuf[k]) {
          k--;
          s = ((colF[q] + q * q) - (colF[vbuf[k]] + vbuf[k] * vbuf[k])) / (2 * q - 2 * vbuf[k]);
        }
        k++; vbuf[k] = q; zbuf[k] = s; zbuf[k + 1] = Infinity;
      }
      // sample the envelope for the inner rows and write fade bytes
      const tx = gx - baseX;
      k = 0;
      for (let z = iz0; z <= izN; z++) {
        while (zbuf[k + 1] < z) k++;
        const dz = z - vbuf[k];
        const D = dz * dz + colF[vbuf[k]];
        // Half-texel inset recovers the "distance to the dug cell's square" rim=0
        // semantics; interior texels have D=0 and stay exactly 0 (fully lit).
        const dCells = Math.max(Math.sqrt(D) - 0.5, 0) / R;
        data[(ez0 + z - baseZ) * w + tx] = Math.round(scale * Math.min(dCells, FADE_RADIUS));
      }
    }
  }

  // Required coverage in cell units: the visible ground rect padded so it spans
  // every chunk the view may load (the BUFFER_CHUNKS ring) plus the fade apron.
  function requiredRect() {
    const pad = BUFFER_CHUNKS * CHUNK_SIZE + FADE_RADIUS;
    const v = visibleGroundRect(camera);
    return {
      minX: v.minX / SIZE - pad, maxX: v.maxX / SIZE + pad,
      minZ: v.minZ / SIZE - pad, maxZ: v.maxZ / SIZE + pad,
    };
  }

  // Window that should cover a required rect: origin snapped to a whole cell
  // MARGIN outside it, size = required span + 2*MARGIN slack (+1 cell to absorb
  // the sub-cell snap). Size depends only on zoom/aspect, so it's stable across
  // pans and changes only when the canvas resizes.
  function windowFor(r) {
    const cellsX = Math.ceil((r.maxX - r.minX) + 2 * MARGIN) + 1;
    const cellsZ = Math.ceil((r.maxZ - r.minZ) + 2 * MARGIN) + 1;
    return {
      oX: Math.floor(r.minX - MARGIN), oZ: Math.floor(r.minZ - MARGIN),
      tw: cellsX * FADE_RESOLUTION, th: cellsZ * FADE_RESOLUTION,
    };
  }

  // Split a global-texel rect into <=TILE_CELLS-per-side tiles on the bake queue.
  function enqueueTiles(gx0, gz0, gx1, gz1) {
    const T = TILE_CELLS * FADE_RESOLUTION;
    for (let bz = gz0; bz <= gz1; bz += T)
      for (let bx = gx0; bx <= gx1; bx += T)
        bakeQueue.push({ gx0: bx, gz0: bz, gx1: Math.min(bx + T - 1, gx1), gz1: Math.min(bz + T - 1, gz1) });
  }

  // Point the DataTexture at the current data + window. Reuse the texture when
  // dimensions are unchanged (the pan case — just swap its data); reallocate only
  // when the required size changed (a canvas resize). The shared uniform objects
  // propagate to every patched material with no re-patching.
  function bindTexture(recreate) {
    if (recreate) {
      if (fadeMap) fadeMap.dispose();
      fadeMap = new THREE.DataTexture(data, w, h, THREE.RedFormat, THREE.UnsignedByteType);
      fadeMap.magFilter = fadeMap.minFilter = THREE.LinearFilter;
      fadeMap.unpackAlignment = 1;   // rows are tightly packed single bytes
      uniforms.uFadeMap.value = fadeMap;
    } else {
      fadeMap.image.data = data;
    }
    fadeMap.needsUpdate = true;
    uniforms.uFadeOrigin.value.set(minX * SIZE, minZ * SIZE);
    uniforms.uFadeSpan.value.set(w / FADE_RESOLUTION * SIZE, h / FADE_RESOLUTION * SIZE);
  }

  // Move the window to cover `r`. Blit the region shared with the old window,
  // queue the newly-exposed stripes as bake tiles (nearest-first), then rebind the
  // texture. Not-yet-baked texels default to 255 (fully dark) so they read as
  // unlit until a later processBakeQueue() fills them in. Also builds the very
  // first window (old data null -> whole-window queue, fresh texture).
  function recenter(r) {
    const { oX, oZ, tw, th } = windowFor(r);
    const sameSize = tw === w && th === h;
    const newData = new Uint8Array(tw * th);
    newData.fill(255);
    // Whole-cell origin moves are integer texel shifts; newTx maps to old
    // texel newTx + shiftX. Overlap rect is in NEW texel coordinates.
    const shiftX = (oX - minX) * FADE_RESOLUTION;
    const shiftZ = (oZ - minZ) * FADE_RESOLUTION;
    const cx0 = Math.max(0, -shiftX), cx1 = Math.min(tw - 1, (w - 1) - shiftX);
    const cz0 = Math.max(0, -shiftZ), cz1 = Math.min(th - 1, (h - 1) - shiftZ);
    const haveOverlap = data && cx0 <= cx1 && cz0 <= cz1;

    const oldW = w, oldData = data;
    minX = oX; minZ = oZ; w = tw; h = th; data = newData;

    const R = FADE_RESOLUTION, baseX = minX * R, baseZ = minZ * R;
    if (haveOverlap) {
      for (let tz = cz0; tz <= cz1; tz++) {
        const oz = tz + shiftZ;
        for (let tx = cx0; tx <= cx1; tx++)
          newData[tz * w + tx] = oldData[oz * oldW + (tx + shiftX)];
      }
      // Queue the complement of the overlap as up to four non-overlapping stripes.
      if (cx0 > 0) enqueueTiles(baseX, baseZ, baseX + cx0 - 1, baseZ + h - 1);
      if (cx1 < w - 1) enqueueTiles(baseX + cx1 + 1, baseZ, baseX + w - 1, baseZ + h - 1);
      if (cz0 > 0) enqueueTiles(baseX + cx0, baseZ, baseX + cx1, baseZ + cz0 - 1);
      if (cz1 < h - 1) enqueueTiles(baseX + cx0, baseZ + cz1 + 1, baseX + cx1, baseZ + h - 1);
    } else {
      enqueueTiles(baseX, baseZ, baseX + w - 1, baseZ + h - 1);
    }

    // Bake the tiles nearest the required-rect centre first (matches chunk streaming).
    const gcx = (r.minX + r.maxX) / 2 * R, gcz = (r.minZ + r.maxZ) / 2 * R;
    bakeQueue.sort((a, b) => {
      const ax = (a.gx0 + a.gx1) / 2 - gcx, az = (a.gz0 + a.gz1) / 2 - gcz;
      const bx = (b.gx0 + b.gx1) / 2 - gcx, bz = (b.gz0 + b.gz1) / 2 - gcz;
      return ax * ax + az * az - (bx * bx + bz * bz);
    });
    bindTexture(!sameSize || !fadeMap);
  }

  // Bake up to FADE_BAKE_BUDGET queued tiles this frame. Each tile is clamped to
  // the current window (tiles hold global texel coords, so a re-center mid-queue
  // needs no re-mapping); a tile that scrolled fully out is dropped without
  // consuming budget. Called each frame from main.js beside processBuildQueue().
  function processBakeQueue() {
    const R = FADE_RESOLUTION;
    const wgx0 = minX * R, wgz0 = minZ * R, wgx1 = wgx0 + w - 1, wgz1 = wgz0 + h - 1;
    let baked = false;
    for (let n = 0; n < FADE_BAKE_BUDGET && bakeQueue.length; ) {
      const t = bakeQueue.shift();
      const gx0 = Math.max(t.gx0, wgx0), gz0 = Math.max(t.gz0, wgz0);
      const gx1 = Math.min(t.gx1, wgx1), gz1 = Math.min(t.gz1, wgz1);
      if (gx0 > gx1 || gz0 > gz1) continue;   // scrolled out: skip, keep budget
      bakeRegion(gx0, gz0, gx1, gz1);
      baked = true;
      n++;
    }
    if (baked) fadeMap.needsUpdate = true;
  }

  // Keep the window covering the view; a no-op (zero cost) until panning pushes
  // the required rect past the window's edge. Called each frame from main.js.
  function ensureCoverage() {
    const r = requiredRect();
    if (r.minX >= minX && r.maxX <= minX + w / FADE_RESOLUTION &&
        r.minZ >= minZ && r.maxZ <= minZ + h / FADE_RESOLUTION) return;
    recenter(r);
  }

  recenter(requiredRect());   // build the initial window from the camera's start

  // Patch a built-in material to apply the fade; returns it for chaining.
  // Interior surfaces (tunnel floors, wall faces on the rim) sample distance 0
  // and stay fully lit, so the same patch suits every terrain material.
  function applyTo(material) {
    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>',
          '#include <common>\nvarying vec2 vFadeWorld;')
        .replace('#include <begin_vertex>',
          '#include <begin_vertex>\nvFadeWorld = (modelMatrix * vec4(position, 1.0)).xz;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
uniform sampler2D uFadeMap;
uniform vec2 uFadeOrigin;
uniform vec2 uFadeSpan;
uniform float uMinBrightness;
varying vec2 vFadeWorld;`)
        .replace('#include <color_fragment>', `#include <color_fragment>
float fadeDist = texture2D(uFadeMap, (vFadeWorld - uFadeOrigin) / uFadeSpan).r;
diffuseColor.rgb *= mix(1.0, uMinBrightness, smoothstep(0.0, 1.0, fadeDist));`);
    };
    return material;
  }

  // Re-bake only the texels a dig at (wx, wz) can affect: everything within
  // FADE_RADIUS of the newly-dug cell, plus the cell's own half-extent and a
  // texel of margin, clamped to the window. Stays synchronous — dig feedback must
  // be immediate — and the region is tiny, so it's sub-millisecond.
  function updateAround(wx, wz) {
    const R = FADE_RESOLUTION, reach = FADE_RADIUS + 1;
    const gx0 = Math.max(minX * R, Math.floor((wx - reach) * R));
    const gx1 = Math.min(minX * R + w - 1, Math.ceil((wx + reach) * R));
    const gz0 = Math.max(minZ * R, Math.floor((wz - reach) * R));
    const gz1 = Math.min(minZ * R + h - 1, Math.ceil((wz + reach) * R));
    if (gx0 > gx1 || gz0 > gz1) return;
    bakeRegion(gx0, gz0, gx1, gz1);
    fadeMap.needsUpdate = true;
  }

  return { applyTo, updateAround, ensureCoverage, processBakeQueue };
}
