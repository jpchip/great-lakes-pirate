import * as THREE from 'three';

/** Placeholder scene: a flat water plane and a bobbing box standing in for the schooner. */
export function createTestScene(container: HTMLElement): void {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(container.clientWidth, container.clientHeight);
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x9fb4c2);

  const camera = new THREE.PerspectiveCamera(
    55,
    container.clientWidth / container.clientHeight,
    0.1,
    2000,
  );
  camera.position.set(12, 6, 12);
  camera.lookAt(0, 0, 0);

  scene.add(new THREE.HemisphereLight(0xdfe9f0, 0x2a3a44, 1.2));
  const sun = new THREE.DirectionalLight(0xffffff, 1.5);
  sun.position.set(20, 30, 10);
  scene.add(sun);

  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(400, 400),
    new THREE.MeshStandardMaterial({ color: 0x2d5468, roughness: 0.4 }),
  );
  water.rotation.x = -Math.PI / 2;
  scene.add(water);

  const hull = new THREE.Mesh(
    new THREE.BoxGeometry(2, 1, 6),
    new THREE.MeshStandardMaterial({ color: 0x6b4a2f, flatShading: true }),
  );
  scene.add(hull);

  window.addEventListener('resize', () => {
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
  });

  const timer = new THREE.Timer();
  renderer.setAnimationLoop((time) => {
    timer.update(time);
    const t = timer.getElapsed();
    hull.position.y = 0.3 + Math.sin(t * 1.3) * 0.15;
    hull.rotation.z = Math.sin(t * 0.9) * 0.05;
    hull.rotation.x = Math.sin(t * 0.7) * 0.03;
    renderer.render(scene, camera);
  });
}
