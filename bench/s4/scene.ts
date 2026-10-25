import * as THREE from 'three';
import type { AssetLoader } from '../../src/core/assets';
import { hullTargets, schoonerBuoyancy, type HullTargets } from '../../src/gameplay/buoyancy';
import type { GLTF } from '../../src/render/assets';
import { createLighthouse, type Lighthouse } from '../../src/render/props/lighthouse';
import type { QualityId } from '../../src/render/quality';
import { GameRenderer } from '../../src/render/renderer';
import { createPlaceholderSchooner } from '../../src/render/ships/placeholder-schooner';
import { createSky } from '../../src/render/sky';
import { addOutlines, creaseNormals, OutlineSettings } from '../../src/render/style/outline';
import {
  applyStylizedMaterials,
  StyleLighting,
  type StyleId,
} from '../../src/render/style/stylized-material';
import { TIMES_OF_DAY, type TimeOfDayId } from '../../src/render/style/time-of-day';
import { createWater, type Water } from '../../src/render/water/water';
import { createSea, type Sea } from '../../src/sim/weather/waves';
import { EdgePass } from './edge-pass';

/**
 * The S4 test scene (plan 14 §3.2): the T1 schooner, water, fog on or off and one
 * lighthouse beam, at dusk or at night, in either candidate style. One scene per
 * renderer; the bench builds a fresh one per quality preset, because MSAA is fixed when
 * the WebGL context is created.
 */

/** The four rigs the bench compares. B is split so the outline's cost shows on its own. */
export type VariantId = 'A' | 'B0' | 'B' | 'B-edge';
export const VARIANT_IDS: readonly VariantId[] = ['A', 'B0', 'B', 'B-edge'];

export const VARIANTS: Record<VariantId, { label: string; style: StyleId; outline: Outline }> = {
  A: { label: 'A: low-poly flat', style: 'flat', outline: 'none' },
  B0: { label: 'B without outlines', style: 'toon', outline: 'none' },
  B: { label: 'B: toon + inverted-hull outlines', style: 'toon', outline: 'shell' },
  'B-edge': { label: 'B: toon + screen-space edge pass', style: 'toon', outline: 'edge' },
};

type Outline = 'none' | 'shell' | 'edge';

export type ViewId = 'hero' | 'wide' | 'beam';
export const VIEW_IDS: readonly ViewId[] = ['hero', 'wide', 'beam'];

/** Asset id the pipeline writes for the T1 hull (tools/assets/ship-hull.ts). */
export const HULL_ASSET = 'ship.schooner';

const SCHOONER_HEADING = THREE.MathUtils.degToRad(70);
const LIGHTHOUSE_AT = new THREE.Vector3(-260, 0, -80);

export interface StyleSceneState {
  variant: VariantId;
  time: TimeOfDayId;
  fog: boolean;
  view: ViewId;
  outlineWidth: number;
}

export interface StyleScene {
  readonly renderer: GameRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly water: Water;
  readonly lighthouse: Lighthouse;
  /** Which hull the scene drew: the pipeline's GLB, or the procedural stand-in. */
  readonly hullSource: 'pipeline' | 'placeholder';
  readonly state: Readonly<StyleSceneState>;
  set(next: Partial<StyleSceneState>): void;
  setView(view: ViewId): void;
  /** Draw one frame at `seaTime` seconds. */
  frame(seaTime: number): void;
  resize(): void;
  dispose(): void;
}

function views(): Record<ViewId, { position: THREE.Vector3; target: THREE.Vector3 }> {
  return {
    // Three-quarter view off the starboard bow, the light station behind.
    hero: { position: new THREE.Vector3(60, 10, 52), target: new THREE.Vector3(-6, 9, -6) },
    // Both at once, as a passing ship would see them.
    wide: { position: new THREE.Vector3(110, 30, 160), target: new THREE.Vector3(-110, 6, -40) },
    // From astern, looking past the rig at the light: the beam's sweep is the subject.
    beam: { position: new THREE.Vector3(30, 7, 25), target: new THREE.Vector3(-260, 18, -80) },
  };
}

async function buildSchooner(
  assets: AssetLoader | undefined,
): Promise<{ object: THREE.Group; source: 'pipeline' | 'placeholder' }> {
  if (assets?.has(HULL_ASSET)) {
    const gltf = await assets.acquire<GLTF>(HULL_ASSET);
    const group = new THREE.Group();
    group.add(gltf.scene.clone(true), createPlaceholderSchooner({ hull: false }));
    return { object: group, source: 'pipeline' };
  }
  return { object: createPlaceholderSchooner(), source: 'placeholder' };
}

export async function createStyleScene(
  container: HTMLElement,
  quality: QualityId,
  initial: StyleSceneState,
  assets?: AssetLoader,
): Promise<StyleScene> {
  const renderer = new GameRenderer(container, quality);
  // Fixed resolution, so every variant draws the same number of pixels.
  renderer.dynamicResolution.enabled = false;
  const gl = renderer.renderer;

  const scene = new THREE.Scene();
  const fog = new THREE.Fog(0xffffff, 1, 2);
  scene.fog = fog;
  const horizon = new THREE.Color();
  const zenith = new THREE.Color();
  const sky = createSky(horizon, zenith);
  scene.add(sky);

  const camera = new THREE.PerspectiveCamera(50, renderer.aspect, 0.5, 4000);

  const sea: Sea = createSea();
  const water = createWater(sea, renderer.preset);
  scene.add(water.mesh);

  const lighting = new StyleLighting();
  const outlines = new OutlineSettings();
  outlines.setResolution(gl);

  const { object: schooner, source: hullSource } = await buildSchooner(assets);
  schooner.rotation.order = 'YXZ';
  scene.add(schooner);

  const lighthouse = createLighthouse();
  lighthouse.group.position.copy(LIGHTHOUSE_AT);
  scene.add(lighthouse.group);
  lighthouse.group.updateMatrixWorld(true);

  // Toon bands need smooth normals; the flat style ignores them, so do it once for both.
  const heroes = [schooner, lighthouse.group];
  for (const hero of heroes) creaseNormals(hero);
  const outlineObjects = heroes.flatMap((hero) => addOutlines(hero, outlines));

  const edgePass = new EdgePass(gl, renderer.preset.antialias ? 4 : 0);

  const state: StyleSceneState = { ...initial };
  let appliedStyle: StyleId | undefined;

  const applyState = (): void => {
    const variant = VARIANTS[state.variant];
    if (variant.style !== appliedStyle) {
      for (const hero of heroes) applyStylizedMaterials(hero, variant.style, lighting);
      appliedStyle = variant.style;
      lighthouse.setLamp(TIMES_OF_DAY[state.time].lampIntensity);
    }
    for (const o of outlineObjects) o.visible = variant.outline === 'shell';
    outlines.uniforms.uWidth.value = state.outlineWidth;
    edgePass.width = Math.max(1, state.outlineWidth * 0.75);

    const tod = TIMES_OF_DAY[state.time];
    lighting.apply(tod);
    const air = state.fog ? tod.fog : tod.haze;
    fog.color.set(air.color);
    fog.near = air.near;
    fog.far = air.far;
    // With fog on, the sky dome is the fog bank: it fades to the fog color all the way up.
    horizon.set(state.fog ? air.color : tod.horizon);
    zenith.set(tod.zenith).lerp(horizon, state.fog ? 0.75 : 0);
    gl.setClearColor(horizon);

    const w = water.material.uniforms;
    w.uDeepColor.value.set(tod.water.deep);
    w.uCrestColor.value.set(tod.water.crest);
    w.uSkyColor.value.set(state.fog ? air.color : tod.water.sky);
    w.uSunColor.value.set(tod.water.glint).multiplyScalar(state.time === 'night' ? 0.5 : 1);
    w.uFoamColor.value.set(tod.water.foam);
    w.uSunDirection.value.copy(tod.keyDirection);

    lighthouse.setLamp(tod.lampIntensity);
    // Fog scatters more of the beam toward the eye, but also swallows it sooner.
    if (state.fog) lighthouse.setAtmosphere(0.8, 1 / 300);
    else lighthouse.setAtmosphere(state.time === 'night' ? 0.45 : 0.18, 1 / 1800);
    const lamp = lighthouse.lampPosition(new THREE.Vector3());
    lighting.setLamp(
      lamp,
      new THREE.Color(0xffc873).multiplyScalar(2.2 * tod.lampIntensity),
      state.fog ? 26 : 34,
    );
  };

  const setView = (view: ViewId): void => {
    state.view = view;
    const v = views()[view];
    camera.position.copy(v.position);
    camera.lookAt(v.target);
  };

  const buoyancy = schoonerBuoyancy();
  const targets: HullTargets = { heave: 0, pitch: 0, roll: 0 };
  const resize = (): void => {
    camera.aspect = renderer.aspect;
    camera.updateProjectionMatrix();
    renderer.resize();
    outlines.setResolution(gl);
  };

  applyState();
  setView(state.view);

  return {
    renderer,
    scene,
    camera,
    water,
    lighthouse,
    hullSource,
    state,
    set(next) {
      Object.assign(state, next);
      applyState();
      if (next.view) setView(next.view);
    },
    setView,
    frame(seaTime) {
      sea.time = seaTime;
      // Ride the waves directly on the buoyancy targets; no springs needed for a still ship.
      hullTargets(sea, buoyancy, 0, 0, SCHOONER_HEADING, targets);
      schooner.position.set(0, targets.heave, 0);
      schooner.rotation.set(targets.pitch, -SCHOONER_HEADING, targets.roll);
      lighthouse.update(seaTime, camera);
      sky.position.copy(camera.position);
      water.update(camera, seaTime);
      gl.info.reset();
      if (VARIANTS[state.variant].outline === 'edge') edgePass.render(scene, camera);
      else gl.render(scene, camera);
    },
    resize,
    dispose() {
      edgePass.dispose();
      scene.traverse((node) => {
        if (node instanceof THREE.Mesh || node instanceof THREE.LineSegments) {
          node.geometry.dispose();
          const materials = Array.isArray(node.material) ? node.material : [node.material];
          for (const m of materials) m.dispose();
        }
      });
      gl.dispose();
      gl.domElement.remove();
    },
  };
}
