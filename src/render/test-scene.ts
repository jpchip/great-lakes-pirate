import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { AssetLoader } from '../core/assets';
import type { LoadedZone } from '../sim/terrain/load';
import { TEST_BAY } from '../sim/terrain/test-bay';
import { interpolateTransform, type Entity, type GameWorld, type Transform } from '../gameplay/ecs';
import type { ClockState } from '../core/time';
import type { LocalWeather } from '../sim/weather/local-weather';
import type { StubIsland } from '../sim/weather/shelter';
import type { Sea } from '../sim/weather/waves';
import type { GameRenderer } from './renderer';
import { createSchooner, styleSchooner, type SchoonerModel } from './ships/schooner';
import { T1_SCHOONER_LINES } from './ships/schooner-lines';
import { OutlineSettings } from './style/outline';
import { StyleLighting } from './style/stylized-material';
import { createEnvironmentView, type EnvironmentView } from './environment';
import { createSky } from './sky';
import { createDockMesh } from './terrain/dock';
import { createTerrainView } from './terrain/terrain-mesh';
import { createWater, type Water } from './water/water';

const HORIZON = new THREE.Color(0xb7c6cf);
const ZENITH = new THREE.Color(0x6f8ea3);

export interface TestScene {
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly water: Water;
  readonly environment: EnvironmentView;
  /** The test bay's terrain, when it loaded. */
  readonly zone: LoadedZone | undefined;
  render(alpha: number, seaTime: number, frameSeconds: number): void;
}

/** Greybox stand-ins for the islands the stub shelter field blocks wind with. */
function createStubIsland(island: StubIsland): THREE.Mesh {
  // A bell profile from below the waterline to the summit.
  const profile: THREE.Vector2[] = [];
  const steps = 10;
  for (let i = 0; i <= steps; i++) {
    const r = island.radius * 1.15 * (1 - i / steps);
    const y = -6 + (island.height + 6) * (1 - (r / (island.radius * 1.15)) ** 2) ** 1.5;
    profile.push(new THREE.Vector2(Math.max(r, 0.01), y));
  }
  const mesh = new THREE.Mesh(
    new THREE.LatheGeometry(profile, 28),
    new THREE.MeshLambertMaterial({ color: 0x4d5c45, flatShading: true }),
  );
  mesh.position.set(island.x, 0, island.z);
  mesh.name = 'stub-island';
  return mesh;
}

/**
 * Phase 0 test scene (plan 01 §11 exit criteria): Gerstner water, a sky dome with
 * matching fog, and the player schooner riding the waves. The camera orbits the ship
 * (drag to orbit, wheel to zoom) and follows it, interpolated between ticks.
 *
 * With `zone`, it's the Phase 1 test bay: the Apostles slice's terrain and the greybox
 * Bayfield dock (plan 02 §14.1). Piece D adds day and night, fog and sea state from the
 * weather, and, without a zone, greybox islands for the stub lee.
 */
export async function createTestScene(
  renderer: GameRenderer,
  world: GameWorld,
  sea: Sea,
  assets: AssetLoader,
  weather: LocalWeather,
  clock: ClockState,
  zone?: LoadedZone,
  islands: readonly StubIsland[] = [],
): Promise<TestScene> {
  const scene = new THREE.Scene();
  const sky = createSky(HORIZON.clone(), ZENITH.clone(), true);
  scene.add(sky);

  const camera = new THREE.PerspectiveCamera(50, renderer.aspect, 0.5, 4000);
  camera.position.set(46, 15, 38);

  const hemi = new THREE.HemisphereLight(0xdfe9f0, 0x2a3a44, 1.4);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff2d6, 2);
  scene.add(sun);

  const water = createWater(sea, renderer.preset);
  scene.add(water.mesh);
  renderer.onPresetChange((preset) => water.applyPreset(preset));
  if (!zone) for (const island of islands) scene.add(createStubIsland(island));

  const environment = createEnvironmentView(scene, sky, hemi, sun, water, weather);
  environment.update(clock.gameSeconds, { x: 0, z: 0 });

  if (zone) {
    const terrain = createTerrainView(
      zone.terrain,
      zone.backdrop,
      zone.manifest.heightFormat.tileSamples,
      renderer.preset,
    );
    scene.add(terrain.group);
    renderer.onPresetChange((preset) => terrain.applyPreset(preset));
    for (const dock of TEST_BAY.docks) scene.add(createDockMesh(dock, zone.terrain));
  }

  // Ships are procedural (plan 14 §5) in style B: toon bands and ink outlines (§16). The
  // style lighting follows the environment's sun, moon and sky each frame.
  const lighting = new StyleLighting();
  const outlines = new OutlineSettings();
  const rim = new THREE.Color();

  // Each ship has its own model: the sails and booms pose to its own sailing state.
  const drawn = world.with('transform', 'model');
  const objects = new Map<Entity, SchoonerModel>();
  const add = (e: Entity): void => {
    const model = createSchooner(T1_SCHOONER_LINES);
    styleSchooner(model, lighting, outlines);
    model.group.rotation.order = 'YXZ';
    if (e.sailing) model.settle(e.sailing.state, 0);
    objects.set(e, model);
    scene.add(model.group);
  };
  for (const e of drawn) add(e);
  drawn.onEntityAdded.subscribe(add);
  drawn.onEntityRemoved.subscribe((e) => {
    const model = objects.get(e);
    if (model) scene.remove(model.group);
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
    environment,
    zone,
    render(alpha, seaTime, frameSeconds) {
      environment.update(clock.gameSeconds, { x: 0, z: 0 });
      lighting.fromSceneLights(
        hemi,
        sun,
        rim.copy(hemi.color).multiplyScalar(0.12 * hemi.intensity),
        1.3,
      );
      outlines.setResolution(renderer.renderer);
      for (const [e, model] of objects) {
        const object = model.group;
        if (e.sailing) model.update(e.sailing.state, seaTime, frameSeconds);
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
