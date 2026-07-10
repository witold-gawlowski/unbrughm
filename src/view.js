// Scene, camera, renderer and lights.
//
// A fixed isometric camera holds a constant offset from a movable ground
// `target`. Panning slides `target` across the plane and the camera with it.

import * as THREE from 'three';
import { VIEW_DISTANCE, BACKGROUND } from './config.js';

const VIEW_OFFSET = new THREE.Vector3(100, 100, 100);   // iso direction => 3/4 view

export function createView() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(BACKGROUND);

  const d = VIEW_DISTANCE;
  const aspect = window.innerWidth / window.innerHeight;
  const camera = new THREE.OrthographicCamera(-d * aspect, d * aspect, d, -d, 0.1, 1000);

  const target = new THREE.Vector3(0, 0, 0);
  function updateCamera() {
    camera.position.copy(target).add(VIEW_OFFSET);
    camera.lookAt(target);
    camera.updateMatrixWorld();
  }
  updateCamera();

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  document.body.appendChild(renderer.domElement);

  scene.add(new THREE.AmbientLight(0xffffff, 0.5));
  const sun = new THREE.DirectionalLight(0xffffff, 1.0);
  sun.position.set(1, 2, 1.5);
  scene.add(sun);

  window.addEventListener('resize', () => {
    const a = window.innerWidth / window.innerHeight;
    camera.left = -d * a; camera.right = d * a;
    camera.top = d; camera.bottom = -d;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  return { scene, camera, renderer, target, updateCamera };
}
