import * as THREE from 'three';
import type { AssetLoader } from '../core/assets';
import type { LoadedZone } from '../sim/terrain/load';
import { edgeVisibility, type ZoneEdge } from '../sim/terrain/zone-edge';
import type { TerrainBounds } from '../sim/terrain/zone-terrain';
import type { CoastRun } from '../sim/arena/coast';
import { createCoastMesh, disposeCoastMesh } from './arena/coast-view';
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
import type { NpcView } from './ships/npc-view';
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
import { lightClearing, lightsIn } from '../sim/lighthouses';
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
  /** NPC ships drawn (Phase 3 piece H), once the first one has appeared and loaded. */
  readonly npcs: NpcView | undefined;
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
  /**
   * Swaps the zone drawn (Phase 3 piece A): disposes the last zone's meshes, textures and
   * tile worker, and builds the new one's around the player ship. Undefined is open water.
   */
  setZone(zone: LoadedZone | undefined, edge?: ZoneEdge): void;
  /** Called after each setZone, e.g. for the dev overlay's terrain maps. */
  onZoneChange(listener: () => void): void;
  /**
   * An open-water arena (Phase 3 piece G): no zone, the chart's coast in view as low
   * silhouettes, and fog closing in toward the arena's edge. Undefined ends it.
   */
  setArena(arena: SceneArena | undefined): void;
  render(alpha: number, seaTime: number, frameSeconds: number): void;
}

export interface SceneArena {
  coast: readonly CoastRun[];
  bounds: TerrainBounds;
  edge: ZoneEdge;
}

/** What the scene draws for one zone; all of it goes when the zone does. */
interface ZoneLayer {
  zone: LoadedZone;
  edge: ZoneEdge | undefined;
  terrain: TerrainView;
  vegetation: VegetationView;
  lighthouses: LighthouseView;
  harbors: HarborView;
  harborLayouts: HarborLayout[];
  dispose(): void;
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
  const windCues = createWindCues(water.material.uniforms, weather);
  windCues.catsPaws = renderer.preset.catsPaws;
  renderer.onPresetChange((preset) => (windCues.catsPaws = preset.catsPaws));
  const spray = createSpray(renderer.preset.sprayParticles, water);
  scene.add(spray.points);
  renderer.onPresetChange((preset) => spray.setCapacity(preset.sprayParticles));

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

  const buildLayer = (zone: LoadedZone, edge: ZoneEdge | undefined): ZoneLayer => {
    const unsubscribe: (() => void)[] = [];
    const onPreset = (listener: (preset: typeof renderer.preset) => void): void => {
      unsubscribe.push(renderer.onPresetChange(listener));
    };
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
    const terrain = createTerrainView(
      zone.terrain,
      zone.backdrop,
      zone.manifest.heightFormat.tileSamples,
      renderer.preset,
      { x: start?.x ?? 0, y: 15, z: start?.z ?? 0 },
      true,
      terrainMaterial,
    );
    scene.add(terrain.group);
    onPreset((preset) => {
      terrain.applyPreset(preset);
      setCanopy(preset);
    });

    // Set-piece footprints stay clear of trees for the harbors (piece G).
    const frame = manifestFrame(zone.manifest);
    const lighthouses = createLighthouses(
      frame,
      zone.terrain,
      lighting,
      outlines,
      renderer.preset,
      lightsIn(zone.manifest.zone),
    );
    scene.add(lighthouses.group);
    onPreset((preset) => lighthouses.applyPreset(preset));
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
    const harborLayouts = layoutHarbors(frame, zone.terrain, zone.manifest.zone);
    for (const layout of harborLayouts) clearings.push(...harborClearings(layout));
    const vegetation = createVegetationView(
      terrain,
      createPlantModels(renderer.renderer),
      lighting,
      renderer.preset,
      clearings,
    );
    scene.add(vegetation.group);
    onPreset((preset) => vegetation.applyPreset(preset));
    const terrainData = zone.terrain;
    const harbors = createHarbors(harborLayouts, (x, z) => terrainData.heightAt(x, z), lighting);
    scene.add(harbors.group);
    // Depth bands and shore foam over the whole zone, out to the far islands.
    water.setShore(bakeShore(zone.seabed, zone.shoreline));

    return {
      zone,
      edge,
      terrain,
      vegetation,
      lighthouses,
      harbors,
      harborLayouts,
      dispose() {
        for (const off of unsubscribe) off();
        scene.remove(terrain.group, vegetation.group, lighthouses.group, harbors.group);
        vegetation.dispose();
        terrain.dispose();
        lighthouses.dispose();
        harbors.dispose();
        water.clearShore();
      },
    };
  };
  const stubs = new THREE.Group();
  stubs.name = 'stub-islands';
  for (const island of islands) stubs.add(createStubIsland(island));
  scene.add(stubs);
  let layer: ZoneLayer | undefined;
  const zoneListeners: (() => void)[] = [];
  let arena: { def: SceneArena; coast: THREE.Mesh } | undefined;
  const setArena = (def: SceneArena | undefined): void => {
    if (arena) {
      scene.remove(arena.coast);
      disposeCoastMesh(arena.coast);
    }
    arena = def ? { def, coast: createCoastMesh(def.coast) } : undefined;
    if (arena) scene.add(arena.coast);
    stubs.visible = !layer && !arena;
  };
  const setZone = (zone: LoadedZone | undefined, edge?: ZoneEdge): void => {
    layer?.dispose();
    layer = zone ? buildLayer(zone, edge) : undefined;
    if (zone) setArena(undefined);
    // The greybox islands stand in for the stub lee only when there's no zone or arena.
    stubs.visible = !zone && !arena;
    for (const listener of zoneListeners) listener();
  };
  setZone(zone, edge);

  // Ships are procedural (plan 14 §5).
  const drawn = world.with('transform', 'model');
  // Each ship has its own model: the sails and booms pose to its own sailing state.
  const objects = new Map<Entity, SchoonerModel>();
  const wakes = new Map<Entity, ShipWake>();
  const hull = measureWaterline(createSchooner(T1_SCHOONER_LINES).group);
  // NPC ships load their module with the first one (Phase 3 piece H).
  let npcs: NpcView | undefined;
  let npcsLoading: Promise<void> | undefined;
  const npcsPending = new Set<Entity>();
  const add = (e: Entity): void => {
    if (e.model === 'npc') {
      if (npcs) {
        npcs.add(e);
        return;
      }
      npcsPending.add(e);
      npcsLoading ??= import('./ships/npc-view')
        .then(({ createNpcView }) => {
          npcs = createNpcView({
            scene,
            water,
            lighting,
            outlines,
            windAt: (p) => weather.windAt(p, clock.gameSeconds),
          });
          for (const pending of npcsPending) npcs.add(pending);
          npcsPending.clear();
        })
        .catch((err: unknown) => console.error('NPC ships unavailable', err));
      return;
    }
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
    npcsPending.delete(e);
    npcs?.remove(e);
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
    Math.max(layer?.zone.terrain.contains(x, z) ? layer.zone.terrain.heightAt(x, z) : 0, 0.8);
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
    get npcs() {
      return npcs;
    },
    environment,
    cameraRig,
    get zone() {
      return layer?.zone;
    },
    get terrain() {
      return layer?.terrain;
    },
    get vegetation() {
      return layer?.vegetation;
    },
    atmosphere,
    get lighthouses() {
      return layer?.lighthouses;
    },
    get harbors() {
      return layer?.harbors;
    },
    get harborLayouts() {
      return layer?.harborLayouts ?? [];
    },
    setZone,
    setArena,
    onZoneChange(listener) {
      zoneListeners.push(listener);
    },
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
      // NPC ships: posed on the swell, their wakes, smoke into the wind, lights from dusk.
      npcs?.update(alpha, now, frameSeconds, environment.sunElevationDeg, fog()?.density ?? 0);
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
      if (f && layer?.edge) {
        const bounds = layer.zone.terrain.bounds;
        const v = edgeVisibility(bounds, layer.edge, focus.x, focus.z, MAX_FOG_VISIBILITY_M);
        if (Number.isFinite(v)) f.density = Math.max(f.density, fogDensity(v));
      }
      if (f && arena) {
        const v = edgeVisibility(
          arena.def.bounds,
          arena.def.edge,
          focus.x,
          focus.z,
          MAX_FOG_VISIBILITY_M,
        );
        if (Number.isFinite(v)) f.density = Math.max(f.density, fogDensity(v));
      }
      layer?.harbors.update(environment.sunElevationDeg);
      layer?.lighthouses.update(now, camera.position, environment.sunElevationDeg, f?.density ?? 0);
      layer?.terrain.update(camera.position.x, camera.position.y, camera.position.z);
      layer?.vegetation.update(camera.position.x, camera.position.y, camera.position.z);
      water.update(camera, seaTime);
      renderer.render(scene, camera, frameSeconds);
    },
  };
}
