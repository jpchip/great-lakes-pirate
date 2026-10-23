import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { AssetLoader } from '../core/assets';
import { interpolateTransform, type Entity, type GameWorld, type Transform } from '../gameplay/ecs';
import type { Sea } from '../sim/weather/waves';
import type { GLTF } from './assets';
import type { GameRenderer } from './renderer';
import { createPlaceholderSchooner } from './ships/placeholder-schooner';
import { createSky } from './sky';
import { createWater, type Water } from './water/water';

/** Asset id the pipeline will use for the schooner (spike S4). */
const SCHOONER_ASSET = 'ship.schooner';

const HORIZON = new THREE.Color(0xb7c6cf);
const ZENITH = new THREE.Color(0x6f8ea3);
const SUN_DIRECTION = new THREE.Vector3(0.45, 0.55, -0.35).normalize();

export interface TestScene {
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly water: Water;
  render(alpha: number, seaTime: number, frameSeconds: number): void;
}

/**
 * Phase 0 test scene (plan 01 §11 exit criteria): Gerstner water, a sky dome with
 * matching fog, and the player schooner riding the waves. The camera orbits the ship
 * (drag to orbit, wheel to zoom) and follows it, interpolated between ticks.
 */
export async function createTestScene(
  renderer: GameRenderer,
  world: GameWorld,
  sea: Sea,
  assets: AssetLoader,
): Promise<TestScene> {
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(HORIZON, 150, 1600);
  const sky = createSky(HORIZON, ZENITH);
  scene.add(sky);

  const camera = new THREE.PerspectiveCamera(50, renderer.aspect, 0.5, 4000);
  camera.position.set(46, 15, 38);

  scene.add(new THREE.HemisphereLight(0xdfe9f0, 0x2a3a44, 1.4));
  const sun = new THREE.DirectionalLight(0xfff2d6, 2);
  sun.position.copy(SUN_DIRECTION).multiplyScalar(100);
  scene.add(sun);

  const water = createWater(sea, renderer.preset);
  water.material.uniforms.uSunDirection.value.copy(SUN_DIRECTION);
  water.material.uniforms.uSkyColor.value.copy(HORIZON);
  scene.add(water.mesh);
  renderer.onPresetChange((preset) => water.applyPreset(preset));

  // The real hull once the asset pipeline exports one; the procedural stand-in until then.
  let schooner: THREE.Object3D;
  if (assets.has(SCHOONER_ASSET)) {
    schooner = (await assets.acquire<GLTF>(SCHOONER_ASSET)).scene;
  } else {
    schooner = createPlaceholderSchooner();
  }

  const drawn = world.with('transform', 'model');
  const objects = new Map<Entity, THREE.Object3D>();
  const add = (e: Entity): void => {
    // One schooner model for now; instances share geometry and materials.
    const object = objects.size === 0 ? schooner : schooner.clone();
    object.rotation.order = 'YXZ';
    objects.set(e, object);
    scene.add(object);
  };
  for (const e of drawn) add(e);
  drawn.onEntityAdded.subscribe(add);
  drawn.onEntityRemoved.subscribe((e) => {
    const object = objects.get(e);
    if (object) scene.remove(object);
    objects.delete(e);
  });

  const controls = new OrbitControls(camera, renderer.renderer.domElement);
  controls.enableDamping = true;
  controls.minDistance = 12;
  controls.maxDistance = 220;
  controls.maxPolarAngle = Math.PI * 0.48;
  controls.target.set(0, 3, 0);

  window.addEventListener('resize', () => {
    camera.aspect = renderer.aspect;
    camera.updateProjectionMatrix();
    renderer.resize();
  });

  const t: Transform = { position: { x: 0, y: 0, z: 0 }, heading: 0 };
  const follow = new THREE.Vector3();
  return {
    scene,
    camera,
    water,
    render(alpha, seaTime, frameSeconds) {
      for (const [e, object] of objects) {
        interpolateTransform(e, alpha, t);
        object.position.set(t.position.x, t.position.y, t.position.z);
        // Heading is clockwise from north; three.js yaw is counter-clockwise.
        object.rotation.set(t.pitch ?? 0, -t.heading, t.roll ?? 0);
        if (e.playerControlled) {
          // Follow the ship sideways, not up and down, so the swell stays visible.
          follow.set(t.position.x, 3, t.position.z).sub(controls.target);
          controls.target.add(follow);
          camera.position.add(follow);
        }
      }
      controls.update();
      sky.position.copy(camera.position);
      water.update(camera, seaTime);
      renderer.render(scene, camera, frameSeconds);
    },
  };
}
