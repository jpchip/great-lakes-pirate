import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { PoiMarkKind } from '../../../data/schemas/pois';
import { createPoiView } from '../../render/onfoot/poi-view';
import { createLightingSample, sampleLighting } from '../../render/style/lighting-luts';
import { PALETTE } from '../../render/style/palette';
import { StyleLighting } from '../../render/style/stylized-material';
import { moonAt, sunAt } from '../../sim/weather/celestial';
import { CELL_M, TIER_SETS, showcaseCells, showcaseIsland } from './layout';

/**
 * The POI kits' dev page (Phase 9 piece P; `npm run dev`, then /pois.html): every prefab
 * from `pois.json` set down by the game's `placePoi` on ground shaped like its site, drawn
 * by the game's POI view, with an orbit camera. It's the look-over page for the kits (as
 * hideout.html is for the hideout kit) and drives `bench.island`'s POI share per tier.
 *
 * Query options: `?poi=poi.fish_camp,poi.cairn` (just those), `?tier=hero|standard|minor`
 * (that tier's set), `?marks=1` (each named point as a colored pin), `?hour=20`,
 * `?cam=x,y,z` and `?at=x,y,z`. `window.pois.frame(id)` frames one prefab and
 * `window.pois.piece(kind)` one piece; `measure()` reports the kits' calls and triangles.
 */

const DEG = Math.PI / 180;
const params = new URLSearchParams(window.location.search);
let hour = Number(params.get('hour') ?? 15);
const tier = params.get('tier') as keyof typeof TIER_SETS | null;
const only = params.get('poi')?.split(',');

const app = document.getElementById('app');
const hudEl = document.getElementById('hud');
if (!app || !hudEl) throw new Error('Missing #app or #hud');
const container: HTMLElement = app;
const hud: HTMLElement = hudEl;

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(container.clientWidth, container.clientHeight);
container.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x8a9aa6, 150, 900);
scene.background = new THREE.Color();
const camera = new THREE.PerspectiveCamera(
  45,
  container.clientWidth / container.clientHeight,
  0.1,
  3000,
);

const cells = showcaseCells(tier && TIER_SETS[tier] ? TIER_SETS[tier] : only);
const { island, marks, ground: heightAt } = showcaseIsland(cells);
const lighting = new StyleLighting();
const t0 = performance.now();
const view = createPoiView([island], lighting);
const buildMs = performance.now() - t0;
scene.add(view.group);

// The ground, colored as the terrain shader would by height and slope, and the lake.
const span = cells.length * CELL_M;
const groundGeo = new THREE.PlaneGeometry(span, 120, Math.round(span / 1.5), 80).rotateX(
  -Math.PI / 2,
);
groundGeo.translate(span / 2 - CELL_M / 2, 0, 10);
const gp = groundGeo.getAttribute('position') as THREE.BufferAttribute;
for (let k = 0; k < gp.count; k++) gp.setY(k, heightAt(gp.getX(k), gp.getZ(k)));
groundGeo.computeVertexNormals();
const gn = groundGeo.getAttribute('normal') as THREE.BufferAttribute;
const gc = new Float32Array(gp.count * 3);
const sand = new THREE.Color(PALETTE.beachSand);
const wet = new THREE.Color(PALETTE.wetSand);
const meadow = new THREE.Color(PALETTE.meadow);
const forest = new THREE.Color(PALETTE.forestFloor);
const rock = new THREE.Color(PALETTE.sandstone);
for (let k = 0; k < gp.count; k++) {
  const y = gp.getY(k);
  const steep = gn.getY(k) < 0.75;
  const c = steep ? rock : y < 0.2 ? wet : y < 1.3 ? sand : y > 8 ? forest : meadow;
  c.toArray(gc, k * 3);
}
groundGeo.setAttribute('color', new THREE.BufferAttribute(gc, 3));
const ground = new THREE.Mesh(groundGeo, new THREE.MeshLambertMaterial({ vertexColors: true }));
const water = new THREE.Mesh(
  new THREE.PlaneGeometry(4000, 4000).rotateX(-Math.PI / 2).translate(span / 2, 0, -1900),
  new THREE.MeshLambertMaterial({ color: 0x2a4655, transparent: true, opacity: 0.85 }),
);
scene.add(ground, water);
const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1.2);
const sun = new THREE.DirectionalLight(0xffffff, 1.5);
scene.add(hemi, sun);

// The named points as pins, colored by kind.
const PIN: Record<PoiMarkKind, number> = {
  fire: 0xff7a2a,
  resident: 0x4fa3ff,
  dig: 0x9a6a3a,
  cache: 0xf2d04a,
  view: 0xffffff,
  cave: 0xb04ad0,
  landing: 0x3ad08a,
  search: 0xe04848,
};
const pins = new THREE.Group();
pins.visible = params.has('marks');
for (const m of marks) {
  const pin = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.35),
    new THREE.MeshBasicMaterial({ color: PIN[m.kind] }),
  );
  pin.position.set(m.x, m.y + 1.6, m.z);
  const stem = new THREE.Mesh(
    new THREE.CylinderGeometry(0.03, 0.03, 1.3),
    new THREE.MeshBasicMaterial({ color: PIN[m.kind] }),
  );
  stem.position.set(m.x, m.y + 0.65, m.z);
  pins.add(pin, stem);
}
scene.add(pins);

const controls = new OrbitControls(camera, renderer.domElement);
const at = params.get('at')?.split(',').map(Number);
const cam = params.get('cam')?.split(',').map(Number);
controls.target.set(...((at ?? [span / 2 - CELL_M / 2, 2, 0]) as [number, number, number]));
camera.position.set(
  ...((cam ?? [span / 2 - CELL_M / 2, 30 + span * 0.25, -60 - span * 0.35]) as [
    number,
    number,
    number,
  ]),
);
controls.update();

const sample = createLightingSample();
function setTime(): void {
  const gs = 6 * 86400 + hour * 3600;
  const s = sunAt(gs);
  const moon = moonAt(gs);
  const elev = s.elevationRad / DEG;
  sampleLighting(elev, { cloud01: 0.15, storm01: 0, fog01: 0 }, sample);
  const dir = (b: { azimuthRad: number; elevationRad: number }) =>
    new THREE.Vector3(
      Math.cos(b.elevationRad) * Math.sin(b.azimuthRad),
      Math.sin(b.elevationRad),
      -Math.cos(b.elevationRad) * Math.cos(b.azimuthRad),
    );
  const u = lighting.uniforms;
  const h = Math.max(sample.hemi, 0.08);
  u.uSkyAmbient.value.copy(sample.hemiSky).multiplyScalar(h * 0.55);
  u.uGroundAmbient.value.copy(sample.hemiGround).multiplyScalar(h * 0.45);
  if (s.elevationRad > -0.05) {
    u.uKeyDirection.value.copy(dir(s)).normalize();
    u.uKeyColor.value
      .setHex(0xfff0d8)
      .multiplyScalar(THREE.MathUtils.smoothstep(elev, -3, 12) * 1.1);
  } else if (moon.elevationRad > 0) {
    u.uKeyDirection.value.copy(dir(moon)).normalize();
    u.uKeyColor.value.setHex(0x9fb4d6).multiplyScalar(0.05 + 0.28 * moon.illumination01);
  } else u.uKeyColor.value.setRGB(0, 0, 0);
  (scene.background as THREE.Color).copy(sample.zenith.clone().lerp(sample.horizon, 0.35));
  (scene.fog as THREE.Fog).color.copy(sample.horizon);
  sun.position.copy(u.uKeyDirection.value).multiplyScalar(100);
  sun.intensity = u.uKeyColor.value.r * 2.2;
  hemi.intensity = 0.3 + h;
}
setTime();

window.addEventListener('resize', () => {
  camera.aspect = container.clientWidth / container.clientHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(container.clientWidth, container.clientHeight);
});
window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyT') {
    hour = (hour + (e.shiftKey ? 23 : 1)) % 24;
    setTime();
  }
  if (e.code === 'KeyM') pins.visible = !pins.visible;
});

/** Frames a box from out in front (its open side, north) and a little above, `deg` round. */
function look(c: THREE.Vector3, r: number, deg = 20): void {
  controls.target.copy(c);
  const a = deg * DEG;
  camera.position.set(c.x + Math.sin(a) * r * 2.2, c.y + r * 1.1, c.z - Math.cos(a) * r * 2.2);
  controls.update();
}

/** Frames one prefab (`poi.fish_camp`), as its whole clearing. */
function frame(id: string, deg?: number): boolean {
  const c = cells.find((q) => q.poi.id === id);
  if (!c) return false;
  const [r0, r1] = c.poi.clear.rightM;
  const [o0, o1] = c.poi.clear.outM;
  const r = Math.max(r1 - r0, o1 - o0) * 0.5;
  look(new THREE.Vector3(c.x + (r0 + r1) / 2, heightAt(c.x, c.z) + 1, c.z - (o0 + o1) / 2), r, deg);
  return true;
}

/** Frames the first piece of a kind, close up. */
function piece(kind: string, deg?: number): boolean {
  const p = island.pieces.find((q) => q.kind === kind);
  if (!p) return false;
  const r = Math.max(p.widthM, p.depthM, p.maxY - p.minY, 1.5) * 0.75;
  look(new THREE.Vector3(p.x, (p.minY + p.maxY) / 2, p.z), r, deg);
  return true;
}

/** The kits' own draw calls and triangles, from the current camera. */
function measure(): Record<string, number> {
  view.group.visible = false;
  renderer.render(scene, camera);
  const baseCalls = renderer.info.render.calls;
  const baseTris = renderer.info.render.triangles;
  view.group.visible = true;
  renderer.render(scene, camera);
  return {
    prefabs: cells.length,
    pieces: island.pieces.length,
    marks: marks.length,
    poiCalls: renderer.info.render.calls - baseCalls,
    poiTriangles: renderer.info.render.triangles - baseTris,
    viewTriangles: view.triangles,
    buildMs,
  };
}

let last = performance.now();
let hudTimer = 0;
function tick(now: number): void {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  controls.update();
  renderer.render(scene, camera);
  hudTimer += dt;
  if (hudTimer > 0.25) {
    hudTimer = 0;
    const info = renderer.info.render;
    hud.textContent = [
      `POI kits · ${tier ? `${tier} set` : 'every prefab'} · drag to orbit · T hour (${hour}:00) · M marks`,
      cells.map((c) => c.poi.name).join(' · '),
      `${island.pieces.length} pieces · ${(view.triangles / 1000).toFixed(1)}k kit tris · ${info.calls} calls · ${(info.triangles / 1000).toFixed(0)}k tris`,
    ].join('\n');
    document.body.dataset['ready'] = '1';
  }
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

Object.assign(window, {
  pois: {
    renderer,
    camera,
    controls,
    frame,
    piece,
    measure,
    cells: cells.map((c) => c.poi.id),
    showMarks: (on: boolean) => (pins.visible = on),
    setHour: (h: number) => {
      hour = h;
      setTime();
    },
  },
});
