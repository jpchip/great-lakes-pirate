import * as THREE from 'three';
import { interpolateTransform, type Entity, type GameWorld, type Transform } from '../gameplay/ecs';

/**
 * Placeholder scene: a flat water plane and a box standing in for the schooner. The box
 * follows the player ship entity, interpolated between gameplay ticks.
 */
export function createTestScene(
  container: HTMLElement,
  world: GameWorld,
): { render(alpha: number): void } {
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

  const hullGeometry = new THREE.BoxGeometry(2, 1, 6);
  const hullMaterial = new THREE.MeshStandardMaterial({ color: 0x6b4a2f, flatShading: true });
  const drawn = world.with('transform', 'model');
  const objects = new Map<Entity, THREE.Object3D>();
  const add = (e: Entity): void => {
    const mesh = new THREE.Mesh(hullGeometry, hullMaterial);
    objects.set(e, mesh);
    scene.add(mesh);
  };
  for (const e of drawn) add(e);
  drawn.onEntityAdded.subscribe(add);
  drawn.onEntityRemoved.subscribe((e) => {
    const obj = objects.get(e);
    if (obj) scene.remove(obj);
    objects.delete(e);
  });

  window.addEventListener('resize', () => {
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
  });

  const t: Transform = { position: { x: 0, y: 0, z: 0 }, heading: 0 };
  return {
    render(alpha) {
      for (const [e, obj] of objects) {
        interpolateTransform(e, alpha, t);
        obj.position.set(t.position.x, t.position.y + 0.3, t.position.z);
        // Heading is clockwise from north; three.js yaw is counter-clockwise.
        obj.rotation.y = -t.heading;
      }
      renderer.render(scene, camera);
    },
  };
}
