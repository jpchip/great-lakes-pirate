import * as THREE from 'three';
import type { AssetLoader } from '../core/assets';
import type { LoadedZone } from '../sim/terrain/load';
import { edgeVisibility, type ZoneEdge } from '../sim/terrain/zone-edge';
import { manifestFrame, setPieceFootprint, zoneDef } from '../sim/terrain/zones';
import { clearingFromFootprint, type Clearing } from '../sim/terrain/vegetation';
import { interpolateTransform, type Entity, type GameWorld, type Transform } from '../gameplay/ecs';
import { sceneSpeed, DEFAULT_COMPRESSION } from '../core/coords';
import { R_SAILING, type ClockState } from '../core/time';
import type { LocalWeather } from '../sim/weather/local-weather';
import type { StubIsland } from '../sim/weather/shelter';
import type { Sea } from '../sim/weather/waves';
import { CameraRig } from './camera-rig';
import type { GameRenderer } from './renderer';
import { createSchooner, styleSchooner, type SchoonerModel } from './ships/schooner';
import { T1_SCHOONER_LINES } from './ships/schooner-lines';
import { OutlineSettings } from './style/outline';
import { StyleLighting } from './style/stylized-material';
import {
  createEnvironmentView,
  fogDensity,
  MAX_FOG_VISIBILITY_M,
  type EnvironmentView,
} from './environment';
import { createSky, setSkyQuality } from './sky';
import { createAtmosphere, type Atmosphere } from './atmosphere/atmosphere';
import { createLighthouses, type LighthouseView } from './lighthouses/lighthouses';
import { lightClearing } from '../sim/lighthouses';
import { createHarbors, type HarborView } from './harbors/harbors';
import { harborClearings, layoutHarbors, type HarborLayout } from '../sim/harbors';
import { createTerrainMaterial } from './terrain/terrain-material';
import { createTerrainView, type TerrainView } from './terrain/terrain-mesh';
import {
  createPlantModels,
  createVegetationView,
  vegetationFades,
  type VegetationView,
} from './vegetation/vegetation';
import { createShipWake, measureWaterline, type ShipWake, type WakeShip } from './water/wake';
import { createWater, WATER_FAR_RADIUS_M, type Water } from './water/water';
import { bakeShore } from './water/shore';
import { createSpray, type Spray } from './water/spray';
import { createWindCues, type WindCues } from './water/wind-cues';

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
  /** The sailing camera: chase/orbit, tactical zoom and spyglass (plan 02 §8). */
  readonly cameraRig: CameraRig;
  /** The zone's terrain data and its streamed meshes, when it loaded. */
  readonly zone: LoadedZone | undefined;
  readonly terrain: TerrainView | undefined;
  /** Trees and rocks on the zone's land, when it loaded. */
  readonly vegetation: VegetationView | undefined;
  /** Fog banks, rain and lightning (Phase 2 piece E). */
  readonly atmosphere: Atmosphere;
  /** The Apostles' lights, when the zone loaded (Phase 2 piece F). */
  readonly lighthouses: LighthouseView | undefined;
  /** Bayfield and Ashland, when the zone loaded (Phase 2 piece G). */
  readonly harbors: HarborView | undefined;
  readonly harborLayouts: readonly HarborLayout[];
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
 * matching fog, and the player schooner riding the waves. The plan 02 §8 camera follows
 * the ship, interpolated between ticks (render/camera-rig).
 *
 * With `zone`, it's the whole Apostles zone, its terrain streamed around the camera
 * (Phase 2 piece B), fog closing in at its soft edge, and the greybox Bayfield dock
 * (plan 02 §14.1). Day and night, fog and sea state come from the weather, and, without
 * a zone, greybox islands stand in for the stub lee.
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
  edge?: ZoneEdge,
): Promise<TestScene> {
  const scene = new THREE.Scene();
  const sky = createSky(HORIZON.clone(), ZENITH.clone(), true, true);
  setSkyQuality(sky, renderer.preset);
  scene.add(sky);
  renderer.onPresetChange((preset) => setSkyQuality(sky, preset));

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
  windCues.catsPaws = renderer.preset.catsPaws;
  renderer.onPresetChange((preset) => (windCues.catsPaws = preset.catsPaws));
  const spray = createSpray(renderer.preset.sprayParticles, water);
  scene.add(spray.points);
  renderer.onPresetChange((preset) => spray.setCapacity(preset.sprayParticles));
  if (!zone) for (const island of islands) scene.add(createStubIsland(island));

  const environment = createEnvironmentView(scene, sky, hemi, sun, water, weather);
  environment.update(clock.gameSeconds, { x: 0, z: 0 });

  // Ships, terrain and vegetation are drawn in style B (plan 14 §16): toon bands, and ink
  // outlines on the ships. The style lighting follows the environment's sun, moon and sky.
  const lighting = new StyleLighting();
  const outlines = new OutlineSettings();
  const rim = new THREE.Color();

  // Fog banks, rain and lightning over the sky and light the environment sets.
  const atmosphere = createAtmosphere(scene, weather, environment, lighting, hemi, renderer.preset);
  scene.add(atmosphere.group);
  renderer.onPresetChange((preset) => atmosphere.applyPreset(preset));

  let terrain: TerrainView | undefined;
  let vegetation: VegetationView | undefined;
  let lighthouses: LighthouseView | undefined;
  let harbors: HarborView | undefined;
  let harborLayouts: HarborLayout[] = [];
  if (zone) {
    // The tiles around the player are built now, behind the load.
    const start = world.with('playerControlled', 'transform').first?.transform.position;
    const terrainMaterial = createTerrainMaterial(lighting);
    const setCanopy = (preset: typeof renderer.preset): void => {
      // The terrain turns forest to canopy color under the impostors' far fade.
      const f = vegetationFades(preset);
      terrainMaterial.uniforms.uCanopyStart.value = f.farStart * 0.9;
      terrainMaterial.uniforms.uCanopyEnd.value = f.farEnd;
    };
    setCanopy(renderer.preset);
    terrain = createTerrainView(
      zone.terrain,
      zone.backdrop,
      zone.manifest.heightFormat.tileSamples,
      renderer.preset,
      { x: start?.x ?? 0, y: 15, z: start?.z ?? 0 },
      true,
      terrainMaterial,
    );
    scene.add(terrain.group);
    const view = terrain;
    renderer.onPresetChange((preset) => {
      view.applyPreset(preset);
      setCanopy(preset);
    });

    // Set-piece footprints stay clear of trees for the harbors (piece G).
    const frame = manifestFrame(zone.manifest);
    lighthouses = createLighthouses(frame, zone.terrain, lighting, outlines, renderer.preset);
    scene.add(lighthouses.group);
    const lights = lighthouses;
    renderer.onPresetChange((preset) => lights.applyPreset(preset));
    const clearings: Clearing[] = zoneDef(zone.manifest.zone).setPieces.map((def) => {
      const f = setPieceFootprint(def, frame);
      return clearingFromFootprint(
        f.anchor,
        f.bearing,
        def.alongM + def.blendM,
        def.inlandM + def.blendM,
        def.seawardM,
      );
    });
    clearings.push(...lighthouses.placed.map(lightClearing));
    // The harbors' buildings and pier ends stay clear of trees too.
    harborLayouts = layoutHarbors(frame, zone.terrain);
    for (const layout of harborLayouts) clearings.push(...harborClearings(layout));
    vegetation = createVegetationView(
      terrain,
      createPlantModels(renderer.renderer),
      lighting,
      renderer.preset,
      clearings,
    );
    scene.add(vegetation.group);
    const plants = vegetation;
    renderer.onPresetChange((preset) => plants.applyPreset(preset));
    const terrainData = zone.terrain;
    harbors = createHarbors(harborLayouts, (x, z) => terrainData.heightAt(x, z), lighting);
    scene.add(harbors.group);
  }

  // Ships are procedural (plan 14 §5).
  const drawn = world.with('transform', 'model');
  // Each ship has its own model: the sails and booms pose to its own sailing state.
  const objects = new Map<Entity, SchoonerModel>();
  const wakes = new Map<Entity, ShipWake>();
  const hull = measureWaterline(createSchooner(T1_SCHOONER_LINES).group);
  const add = (e: Entity): void => {
    const model = createSchooner(T1_SCHOONER_LINES);
    styleSchooner(model, lighting, outlines);
    model.group.rotation.order = 'YXZ';
    if (e.sailing) model.settle(e.sailing.state, 0);
    objects.set(e, model);
    scene.add(model.group);
    if (e.sailing) {
      const wake = createShipWake(hull, water);
      wakes.set(e, wake);
      scene.add(wake.mesh);
    }
  };
  for (const e of drawn) add(e);
  drawn.onEntityAdded.subscribe(add);
  drawn.onEntityRemoved.subscribe((e) => {
    const model = objects.get(e);
    if (model) scene.remove(model.group);
    objects.delete(e);
    const wake = wakes.get(e);
    if (wake) {
      scene.remove(wake.mesh);
      wake.dispose();
    }
    wakes.delete(e);
  });

  const cameraRig = new CameraRig(camera, renderer.renderer.domElement);
  // The camera stays above the hills, and a little above the mean water so swell
  // crests don't cut through it.
  const surface = (x: number, z: number): number =>
    Math.max(zone && zone.terrain.contains(x, z) ? zone.terrain.heightAt(x, z) : 0, 0.8);
  const pose = { position: { x: 0, y: 0, z: 0 }, heading: 0, roll: 0, speed01: 0 };
  const fog = (): THREE.FogExp2 | undefined =>
    scene.fog instanceof THREE.FogExp2 ? scene.fog : undefined;

  window.addEventListener('resize', () => {
    camera.aspect = renderer.aspect;
    camera.updateProjectionMatrix();
    renderer.resize();
  });

  const t: Transform = { position: { x: 0, y: 0, z: 0 }, heading: 0 };
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
    cameraRig,
    zone,
    terrain,
    vegetation,
    atmosphere,
    lighthouses,
    harbors,
    harborLayouts,
    render(alpha, seaTime, frameSeconds) {
      now += frameSeconds;
      for (const [e, model] of objects) {
        const object = model.group;
        if (e.sailing) model.update(e.sailing.state, seaTime, frameSeconds);
        interpolateTransform(e, alpha, t);
        object.position.set(t.position.x, t.position.y, t.position.z);
        // Heading is clockwise from north; three.js yaw is counter-clockwise.
        object.rotation.set(t.pitch ?? 0, -t.heading, t.roll ?? 0);
        if (e.playerControlled) {
          // The spyglass looks from the deck, so the ship's own rig would fill the view.
          object.visible = !cameraRig.ship.spyglass;
          // Follow the ship sideways, not up and down, so the swell stays visible.
          pose.position.x = t.position.x;
          pose.position.z = t.position.z;
          pose.heading = t.heading;
          pose.roll = t.roll ?? 0;
          const sailing = e.sailing;
          pose.speed01 = sailing ? Math.abs(sailing.state.speed) / sailing.cls.hullMaxSpeed : 0;
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
      cameraRig.update(pose, surface, frameSeconds);
      sky.position.copy(camera.position);
      atmosphere.update(frameSeconds, clock.gameSeconds, camera.position, focus);
      environment.update(clock.gameSeconds, focus);
      lighting.fromSceneLights(
        hemi,
        sun,
        rim.copy(hemi.color).multiplyScalar(0.12 * hemi.intensity),
        1.3,
      );
      outlines.setResolution(renderer.renderer);
      windCues.update(focus, clock.gameSeconds, seaTime);
      // The tactical view thins the fog a little for readability (plan 02 §8).
      const f = fog();
      if (f) f.density *= 1 - 0.4 * cameraRig.ship.tactical01;
      // The soft zone edge closes the fog in, tactical view or not (plan 03 §4).
      if (f && zone && edge) {
        const v = edgeVisibility(zone.terrain.bounds, edge, focus.x, focus.z, MAX_FOG_VISIBILITY_M);
        if (Number.isFinite(v)) f.density = Math.max(f.density, fogDensity(v));
      }
      harbors?.update(environment.sunElevationDeg);
      lighthouses?.update(now, camera.position, environment.sunElevationDeg, f?.density ?? 0);
      terrain?.update(camera.position.x, camera.position.y, camera.position.z);
      vegetation?.update(camera.position.x, camera.position.y, camera.position.z);
      water.update(camera, seaTime);
      renderer.render(scene, camera, frameSeconds);
    },
  };
}
