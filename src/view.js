// Scene, camera, renderer and lights.
//
// A fixed isometric camera holds a constant offset from a movable ground
// `target`. Panning slides `target` across the plane and the camera with it.
//
// Lighting is a single shadow-casting directional "sun" plus a hemisphere fill.
// The sun follows `target` so it lights the infinite plane wherever we pan; its
// shadow camera is sized to the viewport's ground footprint and texel-snapped so
// shadow edges stay stable while panning.

import * as THREE from 'three';
import {
  VIEW_DISTANCE, BACKGROUND, SIZE, CHUNK_SPAN, BUFFER_CHUNKS,
  SHADOWS, SUN_OFFSET, SUN_INTENSITY, AMBIENT_INTENSITY, SHADOW_MAP_SIZE,
  SHADOW_RADIUS,
} from './config.js';
import { groundPoint } from './ground.js';

const VIEW_OFFSET = new THREE.Vector3(100, 100, 100);   // iso direction => 3/4 view

export function createView() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(BACKGROUND);

  const d = VIEW_DISTANCE;
  const aspect = window.innerWidth / window.innerHeight;
  const camera = new THREE.OrthographicCamera(-d * aspect, d * aspect, d, -d, 0.1, 1000);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = SHADOWS;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  document.body.appendChild(renderer.domElement);

  // Hemisphere fill: cool sky tint on tops, dark warm on sides. Same cost as an
  // ambient light but breaks up the flatness of uniformly-shaded cube faces.
  scene.add(new THREE.HemisphereLight(0x8899bb, 0x241c16, AMBIENT_INTENSITY));

  const sunOffset = new THREE.Vector3().fromArray(SUN_OFFSET);
  const sun = new THREE.DirectionalLight(0xffffff, SUN_INTENSITY);
  sun.castShadow = SHADOWS;
  sun.shadow.mapSize.set(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);
  sun.shadow.normalBias = 0;   // no bias for now: accept acne, kill peter-panning
                               // (bias is what detaches contact shadows from wall bases)
  sun.shadow.radius = SHADOW_RADIUS;    // soft PCF edges instead of hard blocks
  sun.shadow.blurSamples = 16;
  scene.add(sun);
  scene.add(sun.target);

  // The shadow ortho camera's world-space x/y axes (its "right"/"up"), derived
  // from the fixed light direction with a (0,1,0) up hint — matches how three.js
  // orients the shadow camera. Used both to size and to texel-snap the shadow.
  const lightZ = sunOffset.clone().normalize();                       // camera looks down -Z
  const lightRight = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), lightZ).normalize();
  const lightUp = new THREE.Vector3().crossVectors(lightZ, lightRight).normalize();

  let radius = VIEW_DISTANCE;   // shadow footprint radius, refreshed on resize

  // Size the shadow camera to the viewport's ground footprint: project the four
  // viewport corners onto y = 0, take the farthest from `target`, plus the same
  // buffer apron the chunk loader uses so shadows never clip at the edge.
  function sizeShadowCamera(target) {
    let r = 0;
    for (const [nx, ny] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const p = groundPoint(camera, nx, ny);
      r = Math.max(r, Math.hypot(p.x - target.x, p.z - target.z));
    }
    radius = r + BUFFER_CHUNKS * CHUNK_SPAN;
    const cam = sun.shadow.camera;
    cam.left = -radius; cam.right = radius;
    cam.top = radius; cam.bottom = -radius;
    cam.near = 0.1;
    cam.far = sunOffset.length() + radius;   // reaches from the sun past the far edge
    cam.updateProjectionMatrix();
  }

  const target = new THREE.Vector3(0, 0, 0);
  function updateCamera() {
    camera.position.copy(target).add(VIEW_OFFSET);
    camera.lookAt(target);
    camera.updateMatrixWorld();

    // Follow the target with the sun, but snap the shadow-camera centre to whole
    // shadow-map texels (in light space) so shadow edges don't shimmer on pan.
    const texel = (2 * radius) / SHADOW_MAP_SIZE;
    const centre = lightRight.clone().multiplyScalar(Math.round(target.dot(lightRight) / texel) * texel)
      .addScaledVector(lightUp, Math.round(target.dot(lightUp) / texel) * texel)
      .addScaledVector(lightZ, target.dot(lightZ));
    sun.target.position.copy(centre);
    sun.target.updateMatrixWorld();
    sun.position.copy(centre).add(sunOffset);
  }
  updateCamera();          // position the camera so groundPoint() can project
  sizeShadowCamera(target);
  updateCamera();          // re-snap the sun now that `radius` is set

  window.addEventListener('resize', () => {
    const a = window.innerWidth / window.innerHeight;
    camera.left = -d * a; camera.right = d * a;
    camera.top = d; camera.bottom = -d;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    sizeShadowCamera(target);
    updateCamera();
  });

  return { scene, camera, renderer, target, updateCamera };
}
