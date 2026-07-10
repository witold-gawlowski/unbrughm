// Pixel-precise darkness: rock fades with the true Euclidean distance to the
// nearest dug-out area, evaluated per fragment.
//
// The map's interiorDistance() is baked once at load into a small
// distance-field texture (FADE_RESOLUTION texels per cell) covering the map
// plus a FADE_RADIUS apron. A shader patch on the terrain materials samples it
// with bilinear filtering at each fragment's world position and dims the
// diffuse color, so the gradient is continuous within faces, across cubes and
// chunks, independent of geometry. Distance is capped at FADE_RADIUS, so the
// apron's edge texels are already fully dark and clamped sampling extends them
// correctly over the infinite outer rock.

import * as THREE from 'three';
import { SIZE, FADE_RADIUS, MIN_BRIGHTNESS, FADE_RESOLUTION } from './config.js';

export function createDarkness({ interiorDistance, bounds }) {
  // Texture rect in cell units: the map's outer cell edges plus the apron.
  const minX = bounds.minX - 0.5 - FADE_RADIUS;
  const minZ = bounds.minZ - 0.5 - FADE_RADIUS;
  const w = Math.ceil((bounds.maxX + 0.5 + FADE_RADIUS - minX) * FADE_RESOLUTION);
  const h = Math.ceil((bounds.maxZ + 0.5 + FADE_RADIUS - minZ) * FADE_RESOLUTION);

  const data = new Uint8Array(w * h);
  for (let tz = 0; tz < h; tz++)
    for (let tx = 0; tx < w; tx++)
      data[tz * w + tx] = Math.round(255 / FADE_RADIUS * interiorDistance(
        minX + (tx + 0.5) / FADE_RESOLUTION,
        minZ + (tz + 0.5) / FADE_RESOLUTION));

  const fadeMap = new THREE.DataTexture(data, w, h, THREE.RedFormat, THREE.UnsignedByteType);
  fadeMap.magFilter = fadeMap.minFilter = THREE.LinearFilter;
  fadeMap.unpackAlignment = 1;   // rows are tightly packed single bytes
  fadeMap.needsUpdate = true;

  // Shared across all patched materials; world-space rect the texture covers.
  const uniforms = {
    uFadeMap: { value: fadeMap },
    uFadeOrigin: { value: new THREE.Vector2(minX * SIZE, minZ * SIZE) },
    uFadeSpan: { value: new THREE.Vector2(w / FADE_RESOLUTION * SIZE, h / FADE_RESOLUTION * SIZE) },
    uMinBrightness: { value: MIN_BRIGHTNESS },
  };

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

  return { applyTo };
}
