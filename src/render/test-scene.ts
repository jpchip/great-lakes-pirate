import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { AssetLoader } from '../core/assets';
import type { LoadedZone } from '../sim/terrain/load';
import { TEST_BAY } from '../sim/terrain/test-bay';
import { interpolateTransform, type Entity, type GameWorld, type Transform } from '../gameplay/ecs';
import { sceneSpeed, DEFAULT_COMPRESSION } from '../core/coords';
import { R_SAILING, type ClockState } from '../core/time';
import type { LocalWeather } from '../sim/weather/local-weather';
import type { StubIsland } from '../sim/weather/shelter';
import type { Sea } from '../sim/weather/waves';
import type { GLTF } from './assets';
import type { GameRenderer } from './renderer';
import { createPlaceholderSchooner } from './ships/placeholder-schooner';
import { createEnvironmentView, type EnvironmentView } from './environment';
import { createSky } from './sky';
import { createDockMesh } from './terrain/dock';
import { createTerrainView } from './terrain/terrain-mesh';
import { createShipWake, measureWaterline, type ShipWake, type WakeShip } from './water/wake';
import { createWater, WATER_FAR_RADIUS_M, type Water } from './water/water';
import { bakeShore } from './water/shore';
import { createSpray, type Spray } from './water/spray';
import { createWindCues, type WindCues } from './water/wind-cues';

/** Asset id the pipeline will use for the schooner (spike S4). */
const SCHOONER_ASSET = 'ship.schooner';

const HORIZON = new THREE.Color(0xb7c6cf);
const ZENITH = new THREE.Color(0x6f8ea3);

export interface TestScene {
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly water: Water;
  /** Wind streaks and cat's-paws on the water. */
  readonly windCues: WindCues;
  readonly spray: Spray;
  /** Every ship's bow wave and wake ribbons. */
  readonly wakes: ReadonlyMap<Entity, ShipWake>;
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

  // Far enough for the far-water LOD and the far islands behind it.
  const camera = new THREE.PerspectiveCamera(50, renderer.aspect, 0.5, WATER_FAR_RADIUS_M * 1.05);
  camera.position.set(46, 15, 38);

  const hemi = new THREE.HemisphereLight(0xdfe9f0, 0x2a3a44, 1.4);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff2d6, 2);
  scene.add(sun);

  const water = createWater(sea, renderer.preset);
  scene.add(water.mesh);
  renderer.onPresetChange((preset) => water.applyPreset(preset));
  // Depth bands and shore foam over the whole zone, out to the far islands.
  if (zone) water.setShore(bakeShore(zone.seabed, zone.shoreline));
  const windCues = createWindCues(water.material.uniforms, weather);
  const spray = createSpray(renderer.preset.sprayParticles, water);
  scene.add(spray.points);
  renderer.onPresetChange((preset) => spray.setCapacity(preset.sprayParticles));
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

  // The real hull once the asset pipeline exports one; the procedural stand-in until then.
  let schooner: THREE.Object3D;
  if (assets.has(SCHOONER_ASSET)) {
    schooner = (await assets.acquire<GLTF>(SCHOONER_ASSET)).scene;
  } else {
    schooner = createPlaceholderSchooner();
  }

  const drawn = world.with('transform', 'model');
  const objects = new Map<Entity, THREE.Object3D>();
  const wakes = new Map<Entity, ShipWake>();
  const hull = measureWaterline(schooner);
  const add = (e: Entity): void => {
    // One schooner model for now; instances share geometry and materials.
    const object = objects.size === 0 ? schooner : schooner.clone();
    object.rotation.order = 'YXZ';
    objects.set(e, object);
    scene.add(object);
    if (e.sailing) {
      const wake = createShipWake(hull, water);
      wakes.set(e, wake);
      scene.add(wake.mesh);
    }
  };
  for (const e of drawn) add(e);
  drawn.onEntityAdded.subscribe(add);
  drawn.onEntityRemoved.subscribe((e) => {
    const object = objects.get(e);
    if (object) scene.remove(object);
    objects.delete(e);
    const wake = wakes.get(e);
    if (wake) {
      scene.remove(wake.mesh);
      wake.dispose();
    }
    wakes.delete(e);
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
  const focus = { x: 0, z: 0 };
  const ship: WakeShip & { pitch: number } = {
    x: 0,
    z: 0,
    heading: 0,
    course: 0,
    speed: 0,
    pitch: 0,
  };
  // Real seconds for the wake and spray; they hold still while frameSeconds is 0.
  let now = 0;
  return {
    scene,
    camera,
    water,
    windCues,
    spray,
    wakes,
    environment,
    zone,
    render(alpha, seaTime, frameSeconds) {
      now += frameSeconds;
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
          focus.x = t.position.x;
          focus.z = t.position.z;
        }
        const wake = wakes.get(e);
        if (wake && e.sailing) {
          const s = e.sailing.state;
          ship.x = t.position.x;
          ship.z = t.position.z;
          ship.heading = t.heading;
          ship.course = t.heading + (s.course - s.heading);
          ship.speed = sceneSpeed(s.speed, R_SAILING, DEFAULT_COMPRESSION);
          ship.pitch = t.pitch ?? 0;
          wake.update(ship, now);
          spray.emit(e, ship, hull, frameSeconds);
        }
      }
      spray.update(frameSeconds);
      controls.update();
      sky.position.copy(camera.position);
      environment.update(clock.gameSeconds, focus);
      windCues.update(focus, clock.gameSeconds, seaTime);
      water.update(camera, seaTime);
      renderer.render(scene, camera, frameSeconds);
    },
  };
}
