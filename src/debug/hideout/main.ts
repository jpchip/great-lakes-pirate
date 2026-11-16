import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { createLampPools } from '../../render/district/district-view';
import { createHideoutView, type HideoutPieceInput } from '../../render/hideout/hideout-view';
import { createLightingSample, sampleLighting } from '../../render/style/lighting-luts';
import { StyleLighting } from '../../render/style/stylized-material';
import { moonAt, sunAt } from '../../sim/weather/celestial';
import { catalogLayout, compoundLayout, defaultGround } from './sample';

/**
 * The hideout kit's dev page (Phase 8 piece B; `npm run dev`, then /hideout.html): the
 * catalog of every piece in every material, or a compound of any size, under any hour,
 * with an orbit camera. It also drives `bench.hideout` (plan 09 §10, §16.3 criterion 3).
 *
 * Query options: `?show=catalog|compound`, `?pieces=1500`, `?hour=22`, `?bench=1` (a
 * scripted orbit, no input), `?cam=x,y,z` and `?at=x,y,z` (camera and target), `?proxyAt=0`
 * (the distant proxy from any distance).
 */

const DEG = Math.PI / 180;
const params = new URLSearchParams(window.location.search);
const show = params.get('show') ?? 'compound';
const count = Number(params.get('pieces') ?? 1500);
let hour = Number(params.get('hour') ?? 14);
const bench = params.has('bench');

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
scene.fog = new THREE.Fog(0x8a9aa6, 120, 900);
scene.background = new THREE.Color();
const camera = new THREE.PerspectiveCamera(
  50,
  container.clientWidth / container.clientHeight,
  0.1,
  3000,
);

const lighting = new StyleLighting();
const pools = createLampPools();
const proxyAt = params.get('proxyAt');
const view = createHideoutView(lighting, {
  pools,
  ...(proxyAt !== null ? { proxyBeyondM: Number(proxyAt) } : {}),
});
scene.add(view.group);

const layout = show === 'catalog' ? catalogLayout() : compoundLayout(count);
const t0 = performance.now();
view.setAll(layout);
const buildMs = performance.now() - t0;
const t1 = performance.now();
view.rebuildProxy();
const proxyMs = performance.now() - t1;

// Ground and water, so pieces have something to stand in.
const groundGeo = new THREE.PlaneGeometry(400, 400, 100, 100).rotateX(-Math.PI / 2);
const gp = groundGeo.getAttribute('position') as THREE.BufferAttribute;
const gc = new Float32Array(gp.count * 3);
const grass = new THREE.Color(0x5d6a3e);
const sand = new THREE.Color(0xb8a77f);
const bed = new THREE.Color(0x6f6450);
for (let k = 0; k < gp.count; k++) {
  const y = show === 'catalog' ? -0.02 : defaultGround(gp.getX(k), gp.getZ(k));
  gp.setY(k, y);
  (y < -0.3 ? bed : y < 0.25 ? sand : grass).toArray(gc, k * 3);
}
groundGeo.setAttribute('color', new THREE.BufferAttribute(gc, 3));
groundGeo.computeVertexNormals();
const ground = new THREE.Mesh(groundGeo, new THREE.MeshLambertMaterial({ vertexColors: true }));
const water = new THREE.Mesh(
  new THREE.PlaneGeometry(3000, 3000).rotateX(-Math.PI / 2).translate(0, -0.05, -1500),
  new THREE.MeshLambertMaterial({ color: 0x2a4655, transparent: true, opacity: 0.85 }),
);
if (show === 'catalog') ground.position.set(20, 0, 150);
scene.add(ground);
if (show !== 'catalog') scene.add(water);
const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1.2);
const sun = new THREE.DirectionalLight(0xffffff, 1.5);
scene.add(hemi, sun);

const controls = new OrbitControls(camera, renderer.domElement);
const at = params.get('at')?.split(',').map(Number);
const cam = params.get('cam')?.split(',').map(Number);
controls.target.set(
  ...((at ?? (show === 'catalog' ? [24, 0, 40] : [5, 2, 25])) as [number, number, number]),
);
camera.position.set(
  ...((cam ?? (show === 'catalog' ? [24, 40, -20] : [-40, 35, -45])) as [number, number, number]),
);
controls.update();

const sample = createLightingSample();
let night = 0;
function setTime(): void {
  const gs = 6 * 86400 + hour * 3600;
  const s = sunAt(gs);
  const moon = moonAt(gs);
  const elev = s.elevationRad / DEG;
  sampleLighting(elev, { cloud01: 0.15, storm01: 0, fog01: 0 }, sample);
  night = THREE.MathUtils.smoothstep(-elev, -4, 6);
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
  u.uSkyAmbient.value.r = Math.max(u.uSkyAmbient.value.r, 0.045);
  u.uSkyAmbient.value.g = Math.max(u.uSkyAmbient.value.g, 0.055);
  u.uSkyAmbient.value.b = Math.max(u.uSkyAmbient.value.b, 0.085);
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
});

/** Draw calls for the scene without the hideout: subtracted for the hideout's own. */
function baseCalls(): number {
  view.group.visible = false;
  renderer.render(scene, camera);
  const n = renderer.info.render.calls;
  view.group.visible = true;
  return n;
}

const frameTimes: number[] = [];
let last = performance.now();
let benchT = 0;
let hudTimer = 0;
function frame(now: number): void {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (bench) {
    // A slow orbit at 40–60 m around the compound.
    benchT += dt;
    const a = benchT * 0.15;
    camera.position.set(5 + Math.cos(a) * 55, 22 + Math.sin(a * 0.7) * 8, 25 + Math.sin(a) * 55);
    camera.lookAt(5, 2, 25);
  } else controls.update();
  view.update(camera.position, night, controls.target, now);
  renderer.render(scene, camera);
  frameTimes.push(dt * 1000);
  if (frameTimes.length > 600) frameTimes.shift();
  hudTimer += dt;
  if (hudTimer > 0.25) {
    hudTimer = 0;
    const info = renderer.info.render;
    hud.textContent = [
      `Hideout kit · ${show} · drag to orbit · T/Shift+T hour (${hour}:00)`,
      `${view.size} pieces · ${view.batches} batches · ${view.far ? 'PROXY' : 'near'} · ${info.calls} calls · ${(info.triangles / 1000).toFixed(0)}k tris`,
      `built in ${buildMs.toFixed(0)} ms · proxy ${proxyMs.toFixed(0)} ms (${(view.proxyTriangles / 1000).toFixed(1)}k tris) · lamps ${view.lamps().length}`,
    ].join('\n');
    document.body.dataset['ready'] = '1';
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

/**
 * The bench's measurements (plan 09 §10): the hideout's own draw calls up close and from
 * the ship, placing and removing pieces one at a time, and the proxy rebuild.
 */
function measure(): Record<string, number> {
  const keep = camera.position.clone();
  const keepTarget = controls.target.clone();
  camera.position.set(-30, 30, -25);
  camera.lookAt(5, 2, 25);
  view.update(camera.position, night, undefined, performance.now() + 1e6);
  const nearBase = baseCalls();
  renderer.render(scene, camera);
  const nearCalls = renderer.info.render.calls - nearBase;
  const nearTris = renderer.info.render.triangles;
  camera.position.set(5, 6, -600);
  camera.lookAt(5, 2, 25);
  view.update(camera.position, night, undefined, performance.now() + 1e6);
  const farBase = baseCalls();
  renderer.render(scene, camera);
  const farCalls = renderer.info.render.calls - farBase;
  const farTris = renderer.info.render.triangles;
  const farOn = view.far ? 1 : 0;
  // Place 200 new pieces one at a time, then take them away again.
  const placeMs: number[] = [];
  const ids = [
    'build.wall',
    'build.crate_stack',
    'build.lantern',
    'build.roof_slope',
    'build.palisade',
  ];
  for (let k = 0; k < 200; k++) {
    const p: HideoutPieceInput = {
      id: ids[k % ids.length] as string,
      x: -60 + (k % 20) * 2,
      y: 0,
      z: 120 + Math.floor(k / 20) * 2,
      rot: k % 4,
    };
    const s = performance.now();
    view.set(`bench${k}`, p);
    placeMs.push(performance.now() - s);
  }
  const removeMs: number[] = [];
  for (let k = 0; k < 200; k++) {
    const s = performance.now();
    view.remove(`bench${k}`);
    removeMs.push(performance.now() - s);
  }
  const s = performance.now();
  view.rebuildProxy();
  const rebuildMs = performance.now() - s;
  camera.position.copy(keep);
  controls.target.copy(keepTarget);
  placeMs.sort((a, b) => a - b);
  removeMs.sort((a, b) => a - b);
  return {
    pieces: view.size,
    batches: view.batches,
    nearCalls,
    nearTriangles: nearTris,
    farCalls,
    farTriangles: farTris,
    proxyShown: farOn,
    proxyTriangles: view.proxyTriangles,
    placeMsMedian: placeMs[100] ?? 0,
    placeMsMax: placeMs[199] ?? 0,
    removeMsMax: removeMs[199] ?? 0,
    proxyRebuildMs: rebuildMs,
    initialBuildMs: buildMs,
  };
}

/** Shows one piece alone, framed, for the kit's contact sheet. */
function solo(id: string, material?: string, extendM = 0.6): void {
  view.setAll([
    ['solo', { id, ...(material ? { material } : {}), x: 0, y: 0, z: 0, rot: 0, extendM }],
  ]);
  const bb = new THREE.Box3();
  for (const m of view.near.children) {
    const mesh = m as THREE.InstancedMesh;
    if (mesh.count === 0) continue;
    mesh.computeBoundingBox();
    if (mesh.boundingBox) bb.union(mesh.boundingBox);
  }
  const c = bb.getCenter(new THREE.Vector3());
  const r = Math.max(bb.getSize(new THREE.Vector3()).length() / 2, 0.8);
  controls.target.copy(c);
  camera.position.set(c.x - r * 1.5, c.y + r * 1.2, c.z - r * 2.1);
  ground.visible = false;
  water.visible = false;
  controls.update();
}

Object.assign(window, { hideout: { view, renderer, camera, controls, frameTimes, measure, solo } });
