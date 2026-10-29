import * as THREE from 'three';
import { GameRenderer } from '../../src/render/renderer';
import { createSchooner, styleSchooner, type SchoonerModel } from '../../src/render/ships/schooner';
import { T1_SCHOONER_LINES } from '../../src/render/ships/schooner-lines';
import { OutlineSettings } from '../../src/render/style/outline';
import { StyleLighting } from '../../src/render/style/stylized-material';
import { directionFrom, TIMES_OF_DAY, type TimeOfDay } from '../../src/render/style/time-of-day';
import { createSailingState, type SailingState } from '../../src/sim/sailing/controller';

/**
 * Schooner contact sheet (plan 14 §7 review, plan 02 §13): `npm run dev`, then open
 * /bench/ship/. One cell per sail level and point of sail, the T1 schooner in style B,
 * so a change to the lines or the sail shapes can be judged at a glance.
 *
 * Query options: `?time=day|dusk|night`, `?t=3` freezes the flutter clock at 3 s (for
 * screenshots), `?view=bow|beam|stern|hull|deck|quarter` moves the camera, `?cols=4` sets the grid
 * width, `?cell=3` draws one cell full size and `?outline=0` hides the ink.
 */

const params = new URLSearchParams(window.location.search);
const stage = document.getElementById('stage') as HTMLDivElement;
const labels = document.getElementById('labels') as HTMLDivElement;

const DAY: TimeOfDay = {
  ...TIMES_OF_DAY.dusk,
  id: 'dusk',
  label: 'Day',
  horizon: 0xb7c6cf,
  zenith: 0x6f8ea3,
  keyDirection: directionFrom(200, 38),
  keyColor: 0xfff2d6,
  keyIntensity: 1.1,
  skyAmbient: 0xc9d6e0,
  groundAmbient: 0x3a4650,
  ambientIntensity: 0.75,
  rimColor: 0xffffff,
  rimIntensity: 0.12,
};
const timeId = params.get('time') ?? 'day';
const tod = timeId === 'night' ? TIMES_OF_DAY.night : timeId === 'dusk' ? TIMES_OF_DAY.dusk : DAY;

const DEG = Math.PI / 180;

interface Cell {
  label: string;
  state: Partial<SailingState>;
}

/** Wind angles are off the bow, positive from starboard (sim/sailing/controller.ts). */
const CELLS: Cell[] = [
  { label: 'Furled', state: { sailSetting: 0, windAngle: -90 * DEG } },
  { label: 'Reefed', state: { sailSetting: 1, windAngle: -90 * DEG } },
  { label: 'Half', state: { sailSetting: 2, windAngle: -90 * DEG } },
  { label: 'Full, beam reach', state: { sailSetting: 3, windAngle: -90 * DEG } },
  { label: 'Full, close-hauled (starboard tack)', state: { sailSetting: 3, windAngle: 48 * DEG } },
  { label: 'Full, running', state: { sailSetting: 3, windAngle: -170 * DEG } },
  {
    label: 'In irons: luffing (Half)',
    state: { sailSetting: 2, windAngle: 12 * DEG, inIrons: true },
  },
  { label: 'Hoisting: Half → Full', state: { sailSetting: 2.5, windAngle: -90 * DEG } },
];

function stateFor(cell: Cell): SailingState {
  const s = createSailingState();
  Object.assign(s, { windKn: 14, speed: 3, ...cell.state });
  const angle = Math.abs(s.windAngle);
  const noGo = 40 * DEG;
  s.idealTrim = Math.min(Math.max((angle - noGo) / (Math.PI - noGo), 0), 1);
  // Heel to leeward when the sails draw (plan 02 §5.1).
  s.heel = s.inIrons
    ? 0
    : Math.sign(s.windAngle) * 0.12 * Math.min(s.sailSetting / 3, 1) * Math.sin(angle);
  return s;
}

const renderer = new GameRenderer(stage, 'high');
renderer.dynamicResolution.enabled = false;
const gl = renderer.renderer;
gl.autoClear = false;

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(tod.haze.color, tod.haze.near, tod.haze.far);
const water = new THREE.Mesh(
  new THREE.CircleGeometry(400, 48).rotateX(-Math.PI / 2),
  new THREE.MeshBasicMaterial({ color: tod.water.deep }),
);
scene.add(water);

const lighting = new StyleLighting();
lighting.apply(tod);
const outlines = new OutlineSettings();

// `?cell=3` draws one cell full size.
const only = params.has('cell') ? Number(params.get('cell')) : undefined;
if (only !== undefined) CELLS.splice(0, CELLS.length, CELLS[only] as Cell);

const models: { model: SchoonerModel; state: SailingState }[] = CELLS.map((cell) => {
  const model = createSchooner(T1_SCHOONER_LINES);
  styleSchooner(model, lighting, outlines);
  if (params.get('outline') === '0') {
    model.group.traverse((node) => {
      if (node.userData['outline']) node.visible = false;
    });
  }
  const isolate = params.get('isolate');
  if (isolate) {
    for (const child of model.group.children) child.visible = child.name.includes(isolate);
  }
  model.group.rotation.order = 'YXZ';
  return { model, state: stateFor(cell) };
});

const views: Record<string, { position: THREE.Vector3; target: THREE.Vector3 }> = {
  bow: { position: new THREE.Vector3(38, 10, -40), target: new THREE.Vector3(0, 8.5, -2) },
  beam: { position: new THREE.Vector3(58, 9, 0), target: new THREE.Vector3(0, 8.5, -2) },
  stern: { position: new THREE.Vector3(34, 13, 44), target: new THREE.Vector3(0, 8.5, -2) },
  hull: { position: new THREE.Vector3(15, 3.5, -14), target: new THREE.Vector3(0, 1, 0) },
  deck: { position: new THREE.Vector3(9, 9, 16), target: new THREE.Vector3(0, 1.5, 0) },
  quarter: { position: new THREE.Vector3(10, 3, 20), target: new THREE.Vector3(0, 1, 6) },
};
const view = views[params.get('view') ?? 'bow'] ?? (views['bow'] as (typeof views)[string]);
const camera = new THREE.PerspectiveCamera(36, 1, 0.5, 2000);
camera.position.copy(view.position);
camera.lookAt(view.target);

const cols = only !== undefined ? 1 : Number(params.get('cols') ?? 4);
const rows = Math.ceil(CELLS.length / cols);
labels.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
labels.style.gridTemplateRows = `repeat(${rows}, 1fr)`;
for (const cell of CELLS) {
  const div = document.createElement('div');
  div.textContent = cell.label;
  labels.append(div);
}

const frozen = params.has('t') ? Number(params.get('t')) : undefined;
const clear = new THREE.Color(tod.horizon);
function frame(ms: number): void {
  const time = frozen ?? ms / 1000;
  const size = gl.getDrawingBufferSize(new THREE.Vector2());
  outlines.setResolution(gl);
  const w = Math.floor(size.x / cols);
  const h = Math.floor(size.y / rows);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  // Outlines are sized in buffer pixels of the whole canvas; cells share it.
  gl.setScissorTest(true);
  const ratio = gl.getPixelRatio();
  models.forEach(({ model, state }, i) => {
    for (const other of models) other.model.group.visible = other.model === model;
    model.settle(state, time);
    model.group.rotation.set(0, 0, state.heel);
    if (!scene.children.includes(model.group)) scene.add(model.group);
    const x = (i % cols) * w;
    const y = size.y - (Math.floor(i / cols) + 1) * h;
    gl.setViewport(x / ratio, y / ratio, w / ratio, h / ratio);
    gl.setScissor(x / ratio, y / ratio, w / ratio, h / ratio);
    gl.setClearColor(clear);
    gl.clear();
    gl.render(scene, camera);
  });
  gl.setScissorTest(false);
  document.body.dataset['sheet'] = 'ready';
  if (frozen === undefined) requestAnimationFrame(frame);
}

window.addEventListener('resize', () => renderer.resize());
requestAnimationFrame(frame);
