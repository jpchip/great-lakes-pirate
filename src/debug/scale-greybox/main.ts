import { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js';
import { msToKnots, type Chart, type Zone } from '../../core/coords';
import { DEFAULT_BINDINGS, InputMapper } from '../../core/input';
import { createLoop } from '../../core/loop';
import { PointerLook } from '../../core/pointer-look';
import { advanceClock, dayAndHour, R_ON_FOOT, R_SAILING } from '../../core/time';
import { schoonerBuoyancy, buoyancySystem } from '../../gameplay/buoyancy';
import {
  cloneTransform,
  createGameWorld,
  interpolateTransform,
  snapshotTransforms,
  type Transform,
} from '../../gameplay/ecs';
import { FollowCamera } from '../../gameplay/onfoot/camera';
import { ColliderSet } from '../../gameplay/onfoot/colliders';
import {
  createCharacter,
  DEFAULT_CONTROLLER,
  stepCharacter,
  type OnFootZone,
} from '../../gameplay/onfoot/controller';
import { ModeMachine, type Mode } from '../../modes/machine';
import { browserStorage, initialQuality } from '../../render/quality';
import { GameRenderer } from '../../render/renderer';
import { createSea } from '../../sim/weather/waves';
import { createFreighters, FREIGHTER_LENGTH_M, stepFreighter } from './freighters';
import { chartOf, ISLANDS, landmassAt, PLACES, REFERENCE_LEGS, type Landmass } from './geography';
import {
  DEFAULT_HELM,
  SAIL_LEVELS,
  stepHelm,
  targetSpeedKn,
  turningCircle,
  visualSpeed,
  type ShipState,
} from './helm';
import { applyTransform, createGreyboxView, placeCharacter } from './scene';
import { snapToShore } from './setpieces';
import { buildTerrain } from './terrain';

/**
 * Spike S7 entry (dev only: `npm run dev`, then open /scale-greybox.html): a greybox
 * Apostles zone for judging C, R and the freighter scale by feel (plan 03 §11).
 *
 * Query options: `?c=8&r=24&rfoot=6&freighter=0.85` set the starting values.
 */

const params = new URLSearchParams(window.location.search);
const num = (key: string, fallback: number): number => {
  const v = Number(params.get(key));
  return params.has(key) && Number.isFinite(v) && v > 0 ? v : fallback;
};

const NM = 1852;
const SCHOONER_LENGTH_M = 30;

const tuning = {
  compression: num('c', 8),
  rate: num('r', R_SAILING),
  rateOnFoot: num('rfoot', R_ON_FOOT),
  freighterScale: num('freighter', 0.85),
  visibilityKm: 12,
  fov: 50,
};
const helm = { ...DEFAULT_HELM };

const container = document.getElementById('app');
const hud = document.getElementById('hud');
if (!container || !hud) throw new Error('Missing #app or #hud');

const t0 = performance.now();
const terrain = buildTerrain();
const buildMs = performance.now() - t0;
let hf = terrain.heightfield(tuning.compression);

const sea = createSea();
const world = createGameWorld();
const clock = { gameSeconds: 9 * 3600, worldTickAccumulator: 0 };

// The schooner starts in the North Channel off Bayfield, heading north.
const startChart = chartOf(46.8, -90.797);
const ship: ShipState = {
  x: startChart.x / tuning.compression,
  z: -startChart.y / tuning.compression,
  heading: 0.15,
  speedKn: 0,
  sailLevel: 2,
  aground: false,
};
const shipTransform: Transform = {
  position: { x: ship.x, y: 0, z: ship.z },
  heading: ship.heading,
};
const shipEntity = world.add({
  id: 'ship.player',
  transform: shipTransform,
  previousTransform: cloneTransform(shipTransform),
  buoyancy: schoonerBuoyancy(),
  model: 'schooner',
  playerControlled: true,
});

const freighters = createFreighters();
const controller = DEFAULT_CONTROLLER;
const zone: OnFootZone = { ground: hf, colliders: new ColliderSet(), waterLevel: 0 };
const character = createCharacter({ x: 0, y: 0, z: 0 });
const previous: Transform = { position: { x: 0, y: 0, z: 0 }, heading: 0 };

const renderer = new GameRenderer(
  container,
  initialQuality(window.location.search, browserStorage()),
);
const view = createGreyboxView(renderer, terrain, sea, freighters, controller);
view.setCompression(tuning.compression);
view.setFreighterScale(tuning.freighterScale);
view.setVisibility(tuning.visibilityKm * 1000);
view.camera.position.set(ship.x - 60, 25, ship.z + 70);
view.controls.target.set(ship.x, 3, ship.z);

// F toggles going ashore in both contexts, so add it to the on-foot map here.
const input = new InputMapper({
  ...DEFAULT_BINDINGS,
  onFoot: { ...DEFAULT_BINDINGS.onFoot, Interact: ['KeyF', 'KeyE'] },
});
input.attach(window);
const followCamera = new FollowCamera();
const look = new PointerLook(container);

let message = '';
let messageTimer = 0;
const say = (text: string): void => {
  message = text;
  messageTimer = 4;
};

// ---------------------------------------------------------------------------------
// Scale changes

function setCompression(c: number): void {
  const k = tuning.compression / c;
  tuning.compression = c;
  hf = terrain.heightfield(c);
  zone.ground = hf;
  // Same chart position, new zone position.
  ship.x *= k;
  ship.z *= k;
  shipTransform.position.x = ship.x;
  shipTransform.position.z = ship.z;
  shipEntity.previousTransform.position.x = ship.x;
  shipEntity.previousTransform.position.z = ship.z;
  for (const p of [character.position, previous.position]) {
    p.x *= k;
    p.z *= k;
    p.y = Math.max(hf.heightAt(p.x, p.z), 0) + 0.05;
  }
  const target = view.controls.target;
  const offset = view.camera.position.clone().sub(target);
  target.set(target.x * k, target.y, target.z * k);
  view.camera.position.copy(target).add(offset);
  view.setCompression(c);
}

// ---------------------------------------------------------------------------------
// Modes

let lastDt = 1 / 60;

function tickWorld(dt: number, rate: number): void {
  lastDt = dt;
  sea.time += dt;
  advanceClock(clock, dt, rate);
  // Freighters steam on at the zone clock rate, so their visual speed follows R / C.
  for (const f of freighters) stepFreighter(f, dt, rate);
}

const sailing: Mode = {
  id: 'sailing',
  enter() {
    input.context = 'sailing';
    view.controls.enabled = true;
    view.character.visible = false;
    view.camera.near = 1;
    view.camera.updateProjectionMatrix();
    look.detachListeners();
  },
  update(dt) {
    snapshotTransforms(world);
    tickWorld(dt, tuning.rate);
    stepHelm(
      ship,
      {
        steer: (input.isDown('SteerStarboard') ? 1 : 0) - (input.isDown('SteerPort') ? 1 : 0),
        raise: input.pressed('TrimSailsOut'),
        lower: input.pressed('TrimSailsIn'),
        astern: input.isDown('TrimSailsIn'),
      },
      helm,
      { compression: tuning.compression, rate: tuning.rate },
      (x, z) => hf.heightAt(x, z),
      dt,
    );
    shipTransform.position.x = ship.x;
    shipTransform.position.z = ship.z;
    shipTransform.heading = ship.heading;
    buoyancySystem(world, sea, dt);
    if (input.pressed('Interact')) goAshore();
  },
};

const onFoot: Mode = {
  id: 'onFoot',
  enter() {
    input.context = 'onFoot';
    view.controls.enabled = false;
    view.character.visible = true;
    view.camera.near = 0.1;
    view.camera.updateProjectionMatrix();
    look.attach();
    followCamera.yaw = character.heading;
  },
  update(dt) {
    snapshotTransforms(world);
    tickWorld(dt, tuning.rateOnFoot);
    buoyancySystem(world, sea, dt);
    previous.position.x = character.position.x;
    previous.position.y = character.position.y;
    previous.position.z = character.position.z;
    previous.heading = character.heading;
    stepCharacter(
      character,
      {
        forward: (input.isDown('MoveForward') ? 1 : 0) - (input.isDown('MoveBack') ? 1 : 0),
        right: (input.isDown('MoveRight') ? 1 : 0) - (input.isDown('MoveLeft') ? 1 : 0),
        run: input.isDown('Sprint'),
        crouch: input.isDown('Crouch'),
        jump: input.pressed('Jump'),
      },
      followCamera.yaw,
      zone,
      dt,
      controller,
    );
    if (input.pressed('Interact')) returnAboard();
  },
};

const machine = new ModeMachine();
machine.register(sailing).register(onFoot);
machine.onTransition((_, to) => (document.body.dataset['mode'] = to));
machine.transition('sailing');

/** Nearest walkable dry land within `radius` zone meters of (x, z). */
function findLanding(x: number, z: number, radius: number): Zone | undefined {
  for (let r = 4; r <= radius; r += 4) {
    const steps = Math.max(16, Math.round((2 * Math.PI * r) / 6));
    for (let k = 0; k < steps; k++) {
      const a = (k / steps) * Math.PI * 2;
      const px = x + Math.sin(a) * r;
      const pz = z - Math.cos(a) * r;
      if (hf.heightAt(px, pz) > 0.4 && hf.slopeAt(px, pz, 2) < controller.maxSlope * 0.8) {
        return { x: px, z: pz };
      }
    }
  }
  return undefined;
}

function putCharacter(at: Zone): void {
  const y = hf.heightAt(at.x, at.z) + 0.05;
  Object.assign(character.position, { x: at.x, y, z: at.z });
  Object.assign(previous.position, { x: at.x, y, z: at.z });
  character.velocity.x = character.velocity.y = character.velocity.z = 0;
  trip.last = undefined;
}

function goAshore(): void {
  const landing = findLanding(ship.x, ship.z, 400);
  if (!landing) {
    say('No walkable shore within 400 m.');
    return;
  }
  putCharacter(landing);
  character.heading = Math.atan2(landing.x - ship.x, -(landing.z - ship.z));
  previous.heading = character.heading;
  machine.transition('onFoot');
}

function returnAboard(): void {
  machine.transition('sailing');
  recenterOrbit();
}

function recenterOrbit(): void {
  // Don't count the jump between the ship and the shore as trip distance.
  trip.last = undefined;
  const target = view.controls.target;
  target.set(ship.x, 3, ship.z);
  view.camera.position.set(
    ship.x - Math.sin(ship.heading) * 80,
    28,
    ship.z + Math.cos(ship.heading) * 80,
  );
}

function teleportShip(chart: Chart, heading: number): void {
  if (machine.mode === 'onFoot') machine.transition('sailing');
  ship.x = chart.x / tuning.compression;
  ship.z = -chart.y / tuning.compression;
  ship.heading = heading;
  ship.speedKn = 0;
  shipTransform.position.x = ship.x;
  shipTransform.position.z = ship.z;
  shipTransform.heading = heading;
  Object.assign(shipEntity.previousTransform, cloneTransform(shipTransform));
  recenterOrbit();
}

function teleportAshore(island: Landmass & { center?: Chart }, uphill = false): void {
  const c = island.center ?? { x: 0, y: 0 };
  const chart = uphill ? c : snapToShore(c, 0.8, 8, 6000);
  const at = findLanding(chart.x / tuning.compression, -chart.y / tuning.compression, 300);
  if (!at) {
    say(`No landing found on ${island.name}.`);
    return;
  }
  putCharacter(at);
  if (machine.mode !== 'onFoot') machine.transition('onFoot');
}

// ---------------------------------------------------------------------------------
// Trip timer (T): real time, game time and distance between two presses.

const trip = {
  running: false,
  realSeconds: 0,
  gameStart: 0,
  gameSeconds: 0,
  zoneMeters: 0,
  last: undefined as Zone | undefined,
};
window.addEventListener('keydown', (e) => {
  if (e.code !== 'KeyT' || e.repeat) return;
  if (trip.running) {
    trip.running = false;
    return;
  }
  Object.assign(trip, {
    running: true,
    realSeconds: 0,
    gameStart: clock.gameSeconds,
    gameSeconds: 0,
    zoneMeters: 0,
  });
  trip.last = undefined;
});

function updateTrip(frameSeconds: number, at: Zone): void {
  if (!trip.running) return;
  trip.realSeconds += frameSeconds;
  trip.gameSeconds = clock.gameSeconds - trip.gameStart;
  if (trip.last) trip.zoneMeters += Math.hypot(at.x - trip.last.x, at.z - trip.last.z);
  trip.last = { x: at.x, z: at.z };
}

// ---------------------------------------------------------------------------------
// Readouts

const fmtM = (m: number): string =>
  m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`;
const fmtClock = (seconds: number): string => {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
const fmtGame = (gameSeconds: number): string => {
  const minutes = Math.round(gameSeconds / 60);
  return minutes >= 60
    ? `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`
    : `${minutes} min`;
};

/** Zone meters to the first land (deeper than −draft counts as water) along a bearing. */
function clearWater(x: number, z: number, bearing: number, max = 4000): number {
  const dx = Math.sin(bearing);
  const dz = -Math.cos(bearing);
  for (let d = 4; d <= max; d += 4) {
    if (hf.heightAt(x + dx * d, z + dz * d) > -helm.draftM) return d;
  }
  return Infinity;
}

function sailingLines(): string[] {
  const c = tuning.compression;
  const scale = { compression: c, rate: tuning.rate };
  const v3d = visualSpeed(ship.speedKn, scale);
  const cruiseKn = targetSpeedKn({ ...ship, sailLevel: 3 }, helm);
  // Show the circle at the current speed, or at Full while stopped.
  const circle = turningCircle(Math.abs(ship.speedKn) > 0.5 ? ship.speedKn : cruiseKn, helm, scale);
  const port = clearWater(ship.x, ship.z, ship.heading - Math.PI / 2);
  const stbd = clearWater(ship.x, ship.z, ship.heading + Math.PI / 2);
  const ahead = clearWater(ship.x, ship.z, ship.heading);
  const width = port + stbd;
  const widthText = Number.isFinite(width)
    ? `${fmtM(width)} (${((width * c) / NM).toFixed(1)} nm real)`
    : 'open water';

  const places = PLACES.map((p) => {
    const at = view.setPieces.positions.get(p.id);
    const d = at ? Math.hypot(at.x - ship.x, at.z - ship.z) : Infinity;
    return { p, d };
  })
    .sort((a, b) => a.d - b.d)
    .slice(0, 2)
    .map(({ p, d }) => {
      const eta = v3d > 0.5 ? ` ETA ${fmtClock(d / v3d)}` : '';
      return `${p.name} ${fmtM(d)}${eta}`;
    });

  let nearestFreighter = Infinity;
  for (const f of freighters) {
    nearestFreighter = Math.min(
      nearestFreighter,
      Math.hypot(f.chart.x / c - ship.x, -f.chart.y / c - ship.z),
    );
  }

  const legs = REFERENCE_LEGS.map((leg) => {
    const chartM = Math.hypot(leg.to.x - leg.from.x, leg.to.y - leg.from.y);
    // Real time is chart distance / (v × R): C cancels out.
    const realS = chartM / (((cruiseKn * NM) / 3600) * tuning.rate);
    return `  ${leg.name}: ${(chartM / NM).toFixed(1)} nm → ${fmtM(chartM / c)} on screen, ${fmtClock(realS)} real`;
  });

  return [
    `W/S sail · A/D helm · hold S furled: sweeps astern · F go ashore · T trip timer · drag to orbit`,
    ``,
    `speed ${ship.speedKn.toFixed(1)} kn game → ${v3d.toFixed(1)} m/s on screen (${msToKnots(v3d).toFixed(1)} visual kn) · ${SAIL_LEVELS[ship.sailLevel]}${ship.aground ? ' · AGROUND' : ''}`,
    `turning circle${Math.abs(ship.speedKn) > 0.5 ? '' : ' at Full'} ${Number.isFinite(circle) ? `${fmtM(circle)} (${(circle / SCHOONER_LENGTH_M).toFixed(1)} ship lengths)` : '—'}`,
    `channel abeam ${widthText} · port ${fmtM(port)} · stbd ${fmtM(stbd)} · ahead ${Number.isFinite(ahead) ? fmtM(ahead) : '> 4 km'}`,
    `nearest ${places.join(' · ')}`,
    `freighter ${Math.round(FREIGHTER_LENGTH_M * tuning.freighterScale)} m (${((FREIGHTER_LENGTH_M * tuning.freighterScale) / SCHOONER_LENGTH_M).toFixed(1)}× the schooner) · nearest ${fmtM(nearestFreighter)}`,
    `legs at Full (${cruiseKn.toFixed(1)} kn):`,
    ...legs,
  ];
}

function onFootLines(): string[] {
  const c = tuning.compression;
  const p = character.position;
  const chartX = p.x * c;
  const chartY = -p.z * c;
  const land = landmassAt(chartX, chartY);
  const lines = [
    `WASD move · Shift run · C crouch · Space hop · F return aboard · T trip timer · click to look`,
    ``,
    `${character.gait} · ${Math.hypot(character.velocity.x, character.velocity.z).toFixed(1)} m/s · ground ${hf.heightAt(p.x, p.z).toFixed(1)} m · slope ${((hf.slopeAt(p.x, p.z, controller.slopeSpan) * 180) / Math.PI).toFixed(0)}° (max ${((controller.maxSlope * 180) / Math.PI).toFixed(0)}°)`,
  ];
  const island = land && 'a' in land ? (land as Landmass & { a: number; b: number }) : undefined;
  if (island) {
    const length = (2 * island.a) / c;
    const width = (2 * island.b) / c;
    const walk = length / controller.walkSpeed;
    const run = length / controller.runSpeed;
    lines.push(
      `on ${island.name}: about ${fmtM(length)} × ${fmtM(width)} here (${((2 * island.a) / 1000).toFixed(1)} km real)`,
      `  end to end: walk ${fmtClock(walk)} (${fmtGame(walk * tuning.rateOnFoot)} game) · run ${fmtClock(run)} (${fmtGame(run * tuning.rateOnFoot)} game)`,
    );
  } else if (land) {
    lines.push(
      `on the ${land.name.toLowerCase()} (only docks and hideout pads are walkable in the game)`,
    );
  }
  return lines;
}

// ---------------------------------------------------------------------------------
// Dev panel

const gui = new GUI({ title: 'S7 scale' });
const scaleFolder = gui.addFolder('Scale');
scaleFolder
  .add(tuning, 'compression', 4, 12, 1)
  .name('C (geography)')
  .onFinishChange((c: number) => setCompression(c));
scaleFolder.add(tuning, 'rate', 8, 48, 1).name('R sailing');
scaleFolder.add(tuning, 'rateOnFoot', 2, 12, 1).name('R on foot');
scaleFolder
  .add(tuning, 'freighterScale', 0.5, 1.2, 0.05)
  .name('Freighter scale')
  .onChange((s: number) => view.setFreighterScale(s));
const presets = { 'C = 6': () => pick(6), 'C = 8': () => pick(8), 'C = 10': () => pick(10) };
const pick = (c: number): void => {
  setCompression(c);
  scaleFolder.controllers.forEach((ctl) => ctl.updateDisplay());
};
for (const name of Object.keys(presets)) scaleFolder.add(presets, name as keyof typeof presets);

const shipFolder = gui.addFolder('Schooner');
shipFolder.add(helm, 'hullMaxSpeedKn', 4, 14, 0.5).name('Hull max (kn)');
shipFolder.add(helm, 'windFactor', 0.2, 1, 0.05).name('Wind factor');
shipFolder.add(helm, 'turnRateDeg', 2, 15, 0.5).name('Turn rate (°/s)');
shipFolder.add(helm, 'accelTau', 2, 12, 0.5).name('Inertia (s)');

const viewFolder = gui.addFolder('View');
viewFolder
  .add(tuning, 'visibilityKm', 2, 30, 1)
  .name('Visibility (km)')
  .onChange((km: number) => view.setVisibility(km * 1000));
viewFolder
  .add(tuning, 'fov', 30, 75, 1)
  .name('FOV')
  .onChange((fov: number) => {
    view.camera.fov = fov;
    view.camera.updateProjectionMatrix();
  });

const goTo = {
  'Sail: off Bayfield': () => teleportShip(chartOf(46.8, -90.797), 0.15),
  'Sail: west of Oak': () => teleportShip(chartOf(46.9, -90.765), 0.05),
  'Sail: Raspberry–Oak': () => teleportShip(chartOf(46.965, -90.765), 0),
  'Sail: Chequamegon Bay': () => teleportShip(chartOf(46.66, -90.85), 0),
  'Sail: off Outer Is.': () => teleportShip(chartOf(47.0, -90.38), -0.4),
  'Ashore: Stockton': () => teleportAshore(island('Stockton')),
  'Ashore: Oak (summit)': () => teleportAshore(island('Oak'), true),
  'Ashore: Madeline': () => teleportAshore(island('Madeline')),
  'Ashore: Raspberry': () => teleportAshore(island('Raspberry')),
};
function island(name: string): (typeof ISLANDS)[number] {
  const found = ISLANDS.find((i) => i.name === name);
  if (!found) throw new Error(`No island ${name}`);
  return found;
}
const goFolder = gui.addFolder('Go to');
for (const name of Object.keys(goTo)) goFolder.add(goTo, name as keyof typeof goTo);
goFolder.close();

// ---------------------------------------------------------------------------------
// Loop

const drawn: Transform = { position: { x: 0, y: 0, z: 0 }, heading: 0 };
let frameMsAvg = 16;
let hudTimer = 0;
const followDelta = { x: 0, z: 0 };

const loop = createLoop({
  tick(dt) {
    machine.update(dt);
    input.endTick();
  },
  frame(alpha, frameSeconds) {
    const c = tuning.compression;
    interpolateTransform(shipEntity, alpha, drawn);
    applyTransform(view.schooner, drawn);
    view.freighters.forEach((mesh, k) => {
      const f = freighters[k];
      if (!f) return;
      mesh.position.set(f.chart.x / c, 0, -f.chart.y / c);
      mesh.rotation.y = -f.heading;
    });

    let focus: Zone;
    if (machine.mode === 'onFoot') {
      const feet = placeCharacter(view.character, character, previous, alpha);
      const { dx, dy } = look.consume();
      followCamera.look(dx, dy);
      followCamera.update(feet, character.crouching, zone, frameSeconds);
      view.camera.position.set(
        followCamera.position.x,
        followCamera.position.y,
        followCamera.position.z,
      );
      view.camera.lookAt(followCamera.target.x, followCamera.target.y, followCamera.target.z);
      focus = { x: feet.x, z: feet.z };
    } else {
      // Follow the ship sideways, not up and down, so the swell stays visible.
      followDelta.x = drawn.position.x - view.controls.target.x;
      followDelta.z = drawn.position.z - view.controls.target.z;
      view.controls.target.x += followDelta.x;
      view.controls.target.z += followDelta.z;
      view.camera.position.x += followDelta.x;
      view.camera.position.z += followDelta.z;
      view.controls.update();
      focus = { x: drawn.position.x, z: drawn.position.z };
    }
    view.trees.update(view.camera.position.x, view.camera.position.z, hf);
    updateTrip(frameSeconds, focus);

    view.water.update(view.camera, sea.time - (1 - alpha) * lastDt);
    renderer.render(view.scene, view.camera, frameSeconds);

    frameMsAvg += (frameSeconds * 1000 - frameMsAvg) * 0.05;
    messageTimer -= frameSeconds;
    hudTimer += frameSeconds;
    if (hudTimer < 0.2) return;
    hudTimer = 0;
    const { day, hour } = dayAndHour(clock.gameSeconds);
    const hh = Math.floor(hour);
    const mm = Math.floor((hour - hh) * 60);
    const rate = machine.mode === 'onFoot' ? tuning.rateOnFoot : tuning.rate;
    const stats = renderer.stats();
    hud.textContent = [
      `S7 scale greybox · ${machine.mode === 'onFoot' ? 'on foot' : 'sailing'}`,
      `C ${c} · R ${tuning.rate} (day ≈ ${Math.round(1440 / tuning.rate)} real min) · R on foot ${tuning.rateOnFoot} · freighters ×${tuning.freighterScale.toFixed(2)}`,
      `clock day ${day + 1} ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')} (×${rate})`,
      ...(machine.mode === 'onFoot' ? onFootLines() : sailingLines()),
      trip.running || trip.realSeconds > 0
        ? `trip ${trip.running ? '●' : '■'} ${fmtClock(trip.realSeconds)} real · ${fmtGame(trip.gameSeconds)} game · ${fmtM(trip.zoneMeters)} on screen = ${((trip.zoneMeters * c) / NM).toFixed(2)} nm`
        : '',
      `frame ${frameMsAvg.toFixed(1)} ms · ${stats.drawCalls} calls · ${(stats.triangles / 1000).toFixed(0)}k tris · ${view.trees.mesh.count} trees · terrain built in ${buildMs.toFixed(0)} ms`,
      messageTimer > 0 ? `\n${message}` : '',
    ].join('\n');
  },
});
loop.start();

// For poking at the greybox from the console or a Playwright script.
Object.assign(window, {
  greybox: {
    tuning,
    helm,
    ship,
    character,
    freighters,
    setCompression,
    teleportShip,
    teleportAshore,
    island,
    machine,
    view,
  },
});
