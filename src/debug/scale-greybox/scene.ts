import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { Transform } from '../../gameplay/ecs';
import type { CharacterState, ControllerParams } from '../../gameplay/onfoot/controller';
import type { GameRenderer } from '../../render/renderer';
import { createPlaceholderSchooner } from '../../render/ships/placeholder-schooner';
import { createSky } from '../../render/sky';
import { createWater, type Water } from '../../render/water/water';
import type { Sea } from '../../sim/weather/waves';
import { createFreighterMesh, type Freighter } from './freighters';
import { createSetPieces, type SetPieces } from './setpieces';
import { CELL, MAX_Y, MIN_X, SAMPLES_X, SAMPLES_Y, type GreyboxTerrain } from './terrain';
import { createTreeField, type TreeField } from './trees';

/**
 * The spike S7 view: the greybox terrain (one mesh, scaled by 1/C), the S2 water and
 * sky, 1:1 trees, towns, lighthouses, freighters, the placeholder schooner and an
 * on-foot capsule. Two cameras share one three.js camera: an orbit chase while sailing
 * and the S5 follow camera on foot.
 */

const HORIZON = new THREE.Color(0xb7c6cf);
const ZENITH = new THREE.Color(0x6f8ea3);
const SUN_DIRECTION = new THREE.Vector3(0.45, 0.55, -0.35).normalize();

const SAND = new THREE.Color(0xc8b98a);
const GRASS = new THREE.Color(0x6d8a4e);
const FOREST = new THREE.Color(0x3f5a3a);
const HIGH = new THREE.Color(0x56664a);
/** Too steep to walk at this C (plan 08 §19: 42°). */
const STEEP = new THREE.Color(0xa0473a);
const SEABED = new THREE.Color(0x6b6a55);

export interface GreyboxView {
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  readonly water: Water;
  readonly setPieces: SetPieces;
  readonly trees: TreeField;
  readonly schooner: THREE.Object3D;
  readonly character: THREE.Object3D;
  readonly freighters: THREE.Object3D[];
  /** Apply a new C: rescale the terrain, recolor slopes, re-lay set pieces. */
  setCompression(c: number): void;
  setFreighterScale(scale: number): void;
  setVisibility(meters: number): void;
}

export function createGreyboxView(
  renderer: GameRenderer,
  terrain: GreyboxTerrain,
  sea: Sea,
  freighters: readonly Freighter[],
  controller: ControllerParams,
): GreyboxView {
  const scene = new THREE.Scene();
  const fog = new THREE.Fog(HORIZON, 1500, 12_000);
  scene.fog = fog;
  const sky = createSky(HORIZON, ZENITH);
  scene.add(sky);

  const camera = new THREE.PerspectiveCamera(50, renderer.aspect, 1, 60_000);
  scene.add(new THREE.HemisphereLight(0xdfe9f0, 0x2a3a44, 1.4));
  const sun = new THREE.DirectionalLight(0xfff2d6, 2);
  sun.position.copy(SUN_DIRECTION).multiplyScalar(100);
  scene.add(sun);

  const water = createWater(sea, renderer.preset);
  water.material.uniforms.uSunDirection.value.copy(SUN_DIRECTION);
  water.material.uniforms.uSkyColor.value.copy(HORIZON);
  scene.add(water.mesh);
  renderer.onPresetChange((preset) => water.applyPreset(preset));

  // The S2 water disc ends 2.5 km out; a flat sheet a little lower carries on to the
  // horizon so distant islands still sit in water.
  const farWater = new THREE.Mesh(
    new THREE.PlaneGeometry(200_000, 200_000),
    new THREE.MeshBasicMaterial({ color: 0x3f6272 }),
  );
  farWater.rotation.x = -Math.PI / 2;
  farWater.position.y = -2.5;
  scene.add(farWater);

  // Terrain: the chart-meter grid at C = 1, scaled by 1/C on x and z.
  const { heights } = terrain;
  const positions = new Float32Array(SAMPLES_X * SAMPLES_Y * 3);
  for (let j = 0; j < SAMPLES_Y; j++) {
    for (let i = 0; i < SAMPLES_X; i++) {
      const k = j * SAMPLES_X + i;
      positions[k * 3] = MIN_X + i * CELL;
      positions[k * 3 + 1] = heights[k] ?? 0;
      positions[k * 3 + 2] = -MAX_Y + j * CELL;
    }
  }
  // Skip quads that are entirely under the (opaque) water.
  const indices: number[] = [];
  const at = (i: number, j: number): number => j * SAMPLES_X + i;
  const h = (i: number, j: number): number => heights[at(i, j)] ?? 0;
  for (let j = 0; j < SAMPLES_Y - 1; j++) {
    for (let i = 0; i < SAMPLES_X - 1; i++) {
      if (Math.max(h(i, j), h(i + 1, j), h(i, j + 1), h(i + 1, j + 1)) < -3) continue;
      indices.push(at(i, j), at(i, j + 1), at(i + 1, j));
      indices.push(at(i + 1, j), at(i, j + 1), at(i + 1, j + 1));
    }
  }
  // Chart-space slope (rise per chart meter) per vertex; ×C gives the zone slope.
  const chartSlope = new Float32Array(SAMPLES_X * SAMPLES_Y);
  for (let j = 0; j < SAMPLES_Y; j++) {
    for (let i = 0; i < SAMPLES_X; i++) {
      const gx = (h(Math.min(i + 1, SAMPLES_X - 1), j) - h(Math.max(i - 1, 0), j)) / (2 * CELL);
      const gz = (h(i, Math.min(j + 1, SAMPLES_Y - 1)) - h(i, Math.max(j - 1, 0))) / (2 * CELL);
      chartSlope[at(i, j)] = Math.hypot(gx, gz);
    }
  }
  const terrainGeo = new THREE.BufferGeometry();
  terrainGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const colors = new Float32Array(positions.length);
  terrainGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  terrainGeo.setIndex(indices);
  terrainGeo.computeVertexNormals();
  const terrainMesh = new THREE.Mesh(
    terrainGeo,
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true }),
  );
  terrainMesh.frustumCulled = false;
  terrainMesh.name = 'terrain';
  scene.add(terrainMesh);

  const recolor = (c: number): void => {
    const maxSlope = Math.tan(controller.maxSlope);
    const col = new THREE.Color();
    for (let k = 0; k < heights.length; k++) {
      const y = heights[k] ?? 0;
      if (y < 0) col.copy(SEABED);
      else if ((chartSlope[k] ?? 0) * c > maxSlope) col.copy(STEEP);
      else if (y < 1.8) col.copy(SAND);
      else if (y < 6) col.copy(SAND).lerp(GRASS, (y - 1.8) / 4.2);
      else if (y < 60) col.copy(FOREST);
      else col.copy(FOREST).lerp(HIGH, Math.min((y - 60) / 60, 1));
      col.toArray(colors, k * 3);
    }
    (terrainGeo.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
  };

  const setPieces = createSetPieces();
  scene.add(setPieces.group);
  const trees = createTreeField();
  scene.add(trees.mesh);

  const schooner = createPlaceholderSchooner();
  schooner.rotation.order = 'YXZ';
  scene.add(schooner);

  const freighterMeshes = freighters.map(() => {
    const mesh = createFreighterMesh();
    scene.add(mesh);
    return mesh;
  });

  // The on-foot capsule, sized like S5's controller, with a nose for its heading.
  const character = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(
      controller.radius,
      controller.standHeight - 2 * controller.radius,
      4,
      10,
    ),
    new THREE.MeshStandardMaterial({ color: 0x2f3b55, roughness: 0.6 }),
  );
  body.position.y = controller.standHeight / 2;
  const nose = new THREE.Mesh(
    new THREE.BoxGeometry(0.12, 0.12, 0.3),
    new THREE.MeshStandardMaterial({ color: 0xe0c070 }),
  );
  nose.position.set(0, controller.standHeight * 0.8, -controller.radius);
  character.add(body, nose);
  character.visible = false;
  scene.add(character);

  const controls = new OrbitControls(camera, renderer.renderer.domElement);
  controls.enableDamping = true;
  controls.minDistance = 15;
  controls.maxDistance = 2500;
  controls.maxPolarAngle = Math.PI * 0.49;

  window.addEventListener('resize', () => {
    camera.aspect = renderer.aspect;
    camera.updateProjectionMatrix();
    renderer.resize();
  });

  return {
    scene,
    camera,
    controls,
    water,
    setPieces,
    trees,
    schooner,
    character,
    freighters: freighterMeshes,
    setCompression(c) {
      terrainMesh.scale.set(1 / c, 1, 1 / c);
      recolor(c);
      setPieces.layout(c, terrain.heightfield(c));
    },
    setFreighterScale(scale) {
      for (const f of freighterMeshes) f.scale.setScalar(scale);
    },
    setVisibility(meters) {
      fog.far = meters;
      fog.near = Math.min(1500, meters * 0.25);
    },
  };
}

/** Copy an interpolated transform into a three.js object (heading is clockwise from north). */
export function applyTransform(object: THREE.Object3D, t: Transform): void {
  object.position.set(t.position.x, t.position.y, t.position.z);
  object.rotation.set(t.pitch ?? 0, -t.heading, t.roll ?? 0);
}

/** Place the capsule from the character's current and previous tick. */
export function placeCharacter(
  object: THREE.Object3D,
  c: CharacterState,
  previous: Transform,
  alpha: number,
): THREE.Vector3 {
  const p = c.position;
  const pr = previous.position;
  object.position.set(
    pr.x + (p.x - pr.x) * alpha,
    pr.y + (p.y - pr.y) * alpha,
    pr.z + (p.z - pr.z) * alpha,
  );
  const dh = Math.atan2(
    Math.sin(c.heading - previous.heading),
    Math.cos(c.heading - previous.heading),
  );
  object.rotation.y = -(previous.heading + dh * alpha);
  return object.position;
}
