import * as THREE from 'three';
import { SHIP_RECORDS } from '../../src/sim/sailing/ships';
import { GameRenderer } from '../../src/render/renderer';
import {
  createFunnelSmoke,
  type FunnelSmoke,
  type SmokeSource,
} from '../../src/render/ships/funnel-smoke';
import { npcLines } from '../../src/render/ships/npc-lines';
import { createNpcShip, styleNpcShip, type NpcShipModel } from '../../src/render/ships/npc-ship';
import { OutlineSettings } from '../../src/render/style/outline';
import { StyleLighting } from '../../src/render/style/stylized-material';
import { directionFrom, TIMES_OF_DAY, type TimeOfDay } from '../../src/render/style/time-of-day';

/**
 * NPC ships contact sheet (Phase 3 piece H look sign-off, plan 14 §7 review): `npm run
 * dev`, then open /bench/npc/. One cell per NPC class in ships.json, in style B, with
 * its smoke trailing in a beam wind and, at dusk and night, its running lights.
 *
 * Query options: `?time=day|dusk|night`, `?view=beam|bow|quarter|stern|high` moves the
 * camera, `?cols=3` sets the grid width, `?cell=2` draws one class full size, `?t=6`
 * pre-rolls the smoke that many seconds and freezes it (for screenshots), and `?scale=1`
 * draws every class at the same scale (meters on screen) instead of filling each cell.
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
  water: { ...TIMES_OF_DAY.dusk.water, deep: 0x3d5866 },
  haze: { color: 0xb7c6cf, near: 600, far: 3000 },
};
const timeId = params.get('time') ?? 'day';
const tod = timeId === 'night' ? TIMES_OF_DAY.night : timeId === 'dusk' ? TIMES_OF_DAY.dusk : DAY;
/** Sun elevation for the lamps: day, the dusk the dusk palette shows, and night. */
const sunElevation = timeId === 'night' ? -20 : timeId === 'dusk' ? -2 : 40;

const renderer = new GameRenderer(stage, 'high');
renderer.dynamicResolution.enabled = false;
const gl = renderer.renderer;
gl.autoClear = false;

const lighting = new StyleLighting();
lighting.apply(tod);
const outlines = new OutlineSettings();

interface Cell {
  label: string;
  model: NpcShipModel;
  scene: THREE.Scene;
  smoke: FunnelSmoke;
  sources: SmokeSource[];
  speed: number;
}

const records = SHIP_RECORDS.filter((r) => r.role === 'npc');
const only = params.has('cell') ? Number(params.get('cell')) : undefined;
const shown = only !== undefined ? records.slice(only, only + 1) : records;
const smokeColor = new THREE.Color();
const cells: Cell[] = shown.map((record) => {
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(tod.haze.color, tod.haze.near, tod.haze.far);
  scene.add(
    new THREE.Mesh(
      new THREE.CircleGeometry(1200, 64).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: tod.water.deep }),
    ),
  );
  const model = createNpcShip(npcLines(record.modelId), record.displayScale);
  styleNpcShip(model, lighting, outlines);
  model.update(sunElevation, 0, false);
  scene.add(model.group);
  const smoke = createFunnelSmoke(lighting);
  scene.add(smoke.points);
  const speed = record.propulsion === 'steam' ? record.engineSpeedKn : record.hullMaxSpeedKn;
  const label = `${record.name} · ${(record.lengthM * record.displayScale).toFixed(0)} m drawn · ${model.triangles} tris`;
  const sources = model.stacks.map(() => ({ owed: 0 }));
  return { label, model, scene, smoke, sources, speed };
});

// The air from the starboard beam, the ship making way: the plume trails aft and to port.
const stepSmoke = (dt: number): void => {
  for (const c of cells) {
    const way = c.speed * 1.5; // scene m/s, about R / C
    smokeColor.set(c.model.lines.paint.smoke);
    c.model.stacks.forEach((s, k) => {
      c.smoke.emit(
        c.sources[k] as SmokeSource,
        s.top,
        { x: 0, z: 0 },
        { x: -9, z: way },
        s.radius,
        smokeColor,
        dt,
      );
    });
    c.smoke.update(dt);
  }
};

const frozen = params.has('t') ? Number(params.get('t')) : undefined;
if (frozen !== undefined) for (let t = 0; t < frozen; t += 1 / 30) stepSmoke(1 / 30);

const viewId = params.get('view') ?? 'quarter';
/** Camera direction from the ship (bow −z, starboard +x) and the look-at height share. */
const VIEWS: Record<string, THREE.Vector3> = {
  beam: new THREE.Vector3(1, 0.12, 0),
  bow: new THREE.Vector3(0.75, 0.2, -1),
  quarter: new THREE.Vector3(1, 0.3, 0.75),
  stern: new THREE.Vector3(0.4, 0.25, 1),
  high: new THREE.Vector3(0.7, 1.1, 0.5),
};
const viewDir = (VIEWS[viewId] ?? (VIEWS['quarter'] as THREE.Vector3)).clone().normalize();
const sameScale = params.get('scale') === '1';
const camera = new THREE.PerspectiveCamera(30, 1, 0.5, 6000);
const box = new THREE.Box3();
const size = new THREE.Vector3();
const center = new THREE.Vector3();
const largest = Math.max(
  ...cells.map((c) => box.setFromObject(c.model.group).getSize(size).length()),
);

const cols = only !== undefined ? 1 : Number(params.get('cols') ?? 3);
const rows = Math.ceil(cells.length / cols);
labels.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
labels.style.gridTemplateRows = `repeat(${rows}, 1fr)`;
for (const cell of cells) {
  const div = document.createElement('div');
  div.textContent = cell.label;
  labels.append(div);
}

const clear = new THREE.Color(tod.horizon);
let last = performance.now();
function frame(now: number): void {
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  if (frozen === undefined) stepSmoke(dt);
  const buffer = gl.getDrawingBufferSize(new THREE.Vector2());
  outlines.setResolution(gl);
  const w = Math.floor(buffer.x / cols);
  const h = Math.floor(buffer.y / rows);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  gl.setScissorTest(true);
  const ratio = gl.getPixelRatio();
  cells.forEach((c, i) => {
    box.setFromObject(c.model.group);
    box.getCenter(center);
    const extent = sameScale ? largest : box.getSize(size).length();
    const distance = (extent * 0.42) / Math.tan((camera.fov * Math.PI) / 360);
    center.y *= 0.8;
    camera.position.copy(center).addScaledVector(viewDir, distance);
    camera.lookAt(center);
    const x = (i % cols) * w;
    const y = buffer.y - (Math.floor(i / cols) + 1) * h;
    gl.setViewport(x / ratio, y / ratio, w / ratio, h / ratio);
    gl.setScissor(x / ratio, y / ratio, w / ratio, h / ratio);
    gl.setClearColor(clear);
    gl.clear();
    gl.render(c.scene, camera);
  });
  gl.setScissorTest(false);
  document.body.dataset['sheet'] = 'ready';
  if (frozen === undefined) requestAnimationFrame(frame);
}

window.addEventListener('resize', () => renderer.resize());
requestAnimationFrame(frame);
