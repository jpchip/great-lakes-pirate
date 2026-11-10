import * as THREE from 'three';
import { EventBus } from '../../core/events';
import { InputMapper } from '../../core/input';
import { createLoop, FixedStepper, GAMEPLAY_TICK_HZ } from '../../core/loop';
import { PointerLook } from '../../core/pointer-look';
import { Rng } from '../../core/rng';
import { dayAndHour } from '../../core/time';
import { createGameWorld } from '../../gameplay/ecs';
import { FollowCamera } from '../../gameplay/onfoot/camera';
import { DEFAULT_CONTROLLER } from '../../gameplay/onfoot/controller';
import type { GameContext, GameEvents } from '../../modes/context';
import { ModeMachine } from '../../modes/machine';
import { createOnFootMode } from '../../modes/on-foot';
import { buildDistrict, type DistrictModel } from '../../gameplay/district/district';
import { decodeGround, districtDef } from '../../gameplay/district/ground';
import { layoutHash, parseLayout, type DistrictLayout } from '../../sim/district/layout';
import { NavMesh, type NavMeshData, type NavPoint } from '../../sim/district/navmesh';
import { createLocalWeather } from '../../sim/weather/local-weather';
import { createSea } from '../../sim/weather/waves';
import { createWorldState } from '../../sim/world-state';
import { createEditor } from './editor';
import { createDistrictScene } from './scene';

/**
 * The docks district dev page (Phase 7 piece C; `npm run dev`, then /district.html): walk
 * the district with the S5 controller at any hour, watch test guards path over the baked
 * navmesh, and switch to the placement editor (Tab) to lay pieces and save the layout.
 *
 * Query options: `?d=bayfield`, `?hour=22`, `?fog=1`, `?guards=12`, `?edit=1`, `?at=x,z`,
 * `?bench=1` (a scripted walk for bench.docks; no pointer lock).
 */

const params = new URLSearchParams(window.location.search);
const def = districtDef(params.get('d') ?? 'bayfield');
const layouts = import.meta.glob('../../../data/districts/*.json', {
  eager: true,
  import: 'default',
});
const layoutJson = layouts[`../../../data/districts/${def.layout}`];
if (!layoutJson) throw new Error(`no layout ${def.layout}`);

const container = document.getElementById('app');
const hud = document.getElementById('hud');
if (!container || !hud) throw new Error('Missing #app or #hud');

const base = `districts/${def.bake}/`;
const [groundBytes, navJson] = await Promise.all([
  fetch(`${base}ground.bin`).then(async (r) => new Uint8Array(await r.arrayBuffer())),
  fetch(`${base}navmesh.json`).then(async (r) =>
    r.ok ? ((await r.json()) as NavMeshData) : undefined,
  ),
]);
const ground = decodeGround(groundBytes);
let layout: DistrictLayout = parseLayout(structuredClone(layoutJson));
let model: DistrictModel = buildDistrict(layout, ground, def.waterLevelM);
let nav = navJson ? new NavMesh(navJson) : undefined;

const state = createWorldState('district-dev');
const hour = Number(params.get('hour') ?? 22);
// Day 6 (mid-June of 1900 by the compressed calendar) at the asked hour.
state.environment.clock.gameSeconds = 6 * 86400 + hour * 3600;

const input = new InputMapper();
input.attach(window);
const ctx: GameContext = {
  state,
  world: createGameWorld(),
  rng: Rng.fromState(state.environment.rng),
  input,
  events: new EventBus<GameEvents>(),
  sea: createSea([]),
  weather: createLocalWeather(),
};

const at = params.get('at')?.split(',').map(Number);
const gang = model.mark(def.gangway);
const spawnX = at?.[0] ?? gang.x;
const spawnZ = at?.[1] ?? gang.z;
const spawn = {
  position: { x: spawnX, y: model.floorAt(spawnX, spawnZ) + 0.05, z: spawnZ },
  heading: (gang.headingDeg * Math.PI) / 180,
};
const follow = new FollowCamera();
follow.yaw = spawn.heading;
const bench = params.has('bench');
const look = new PointerLook(container);
if (!bench) look.attach();

// The on-foot mode walks whatever model is current: the editor swaps it on each edit.
const zone = {
  get ground() {
    return model.ground;
  },
  get colliders() {
    return model.colliders;
  },
  get waterLevel() {
    return model.waterLevel;
  },
};
const mode = createOnFootMode(ctx, zone, spawn, () => follow.yaw);
const scene = createDistrictScene(container, def, model, DEFAULT_CONTROLLER);
scene.setFog(params.get('fog') === '1');
scene.setNav(nav);

const machine = new ModeMachine();
machine.register(mode).transition('onFoot');
document.body.dataset['mode'] = 'onFoot';

// --- Test guards: capsules walking navmesh paths between random points --------------------
interface Wanderer {
  path: NavPoint[];
  leg: number;
  x: number;
  y: number;
  z: number;
  heading: number;
}
const guardRng = Rng.fromSeed('district-guards');
const random = (): number => guardRng.next();
const wanderers: Wanderer[] = [];
let pathMs = 0;
let pathCount = 0;
function setGuards(n: number): void {
  wanderers.length = 0;
  if (!nav) return;
  for (let k = 0; k < n; k++) {
    const p = nav.randomPoint(random);
    wanderers.push({ path: [], leg: 0, x: p.x, y: p.y, z: p.z, heading: 0 });
  }
}
setGuards(Number(params.get('guards') ?? 0));
const GUARD_SPEED = 1.4;
function stepGuards(dt: number): void {
  if (!nav) return;
  for (const w of wanderers) {
    if (w.leg >= w.path.length) {
      const t0 = performance.now();
      w.path = nav.findPath({ x: w.x, y: w.y, z: w.z }, nav.randomPoint(random));
      pathMs += performance.now() - t0;
      pathCount++;
      w.leg = 1;
      continue;
    }
    const target = w.path[w.leg];
    if (!target) continue;
    const dx = target.x - w.x;
    const dz = target.z - w.z;
    const d = Math.hypot(dx, dz);
    const step = GUARD_SPEED * dt;
    if (d <= step) {
      w.x = target.x;
      w.z = target.z;
      w.y = target.y;
      w.leg++;
    } else {
      w.x += (dx / d) * step;
      w.z += (dz / d) * step;
      w.y = model.floorAt(w.x, w.z);
      w.heading = Math.atan2(dx, -dz);
    }
  }
}

// --- Editor ---------------------------------------------------------------------------------
const editor = createEditor({
  container,
  scene,
  def,
  get layout() {
    return layout;
  },
  get model() {
    return model;
  },
  get nav() {
    return nav;
  },
  onChange(next) {
    layout = next;
    model = buildDistrict(layout, ground, def.waterLevelM);
    scene.setModel(model);
  },
  onNav(next) {
    nav = next ? new NavMesh(next) : undefined;
    scene.setNav(nav);
    setGuards(wanderers.length);
  },
});

let navShown = false;
window.addEventListener('keydown', (e) => {
  if ((e.target as HTMLElement | null)?.closest?.('input, select, textarea')) return;
  if (e.code === 'Tab') {
    e.preventDefault();
    if (editor.active) editor.exit();
    else editor.enter(mode.character.position);
    input.context = editor.active ? 'menu' : 'onFoot';
    if (editor.active) {
      document.exitPointerLock();
      look.detachListeners();
    } else if (!bench) look.attach();
    document.body.dataset['mode'] = editor.active ? 'edit' : 'onFoot';
  } else if (editor.active) {
    return;
  } else if (e.code === 'KeyT') {
    state.environment.clock.gameSeconds += (e.shiftKey ? -1 : 1) * 3600;
  } else if (e.code === 'KeyN') {
    navShown = !navShown;
    scene.showNav(navShown);
  } else if (e.code === 'KeyG') {
    setGuards(wanderers.length > 0 ? 0 : 12);
  } else if (e.code === 'KeyO') {
    const fog = params.get('fog') !== '1';
    params.set('fog', fog ? '1' : '0');
    scene.setFog(fog);
  }
});
if (params.get('edit') === '1') {
  look.detachListeners();
  editor.enter(mode.character.position);
  input.context = 'menu';
  document.body.dataset['mode'] = 'edit';
}

// --- Bench: a scripted camera along the waterfront -----------------------------------------
const benchRoute = [
  [-37, -60],
  [-40, -24],
  [-10, -10],
  [20, 2],
  [60, 4],
  [80, -30],
  [40, 30],
  [-20, 20],
] as const;
let benchT = 0;
function benchCamera(dt: number): void {
  benchT += dt;
  const seg = Math.floor(benchT / 4) % benchRoute.length;
  const a = benchRoute[seg] ?? benchRoute[0];
  const b = benchRoute[(seg + 1) % benchRoute.length] ?? benchRoute[0];
  const t = (benchT % 4) / 4;
  const x = a[0] + (b[0] - a[0]) * t;
  const z = a[1] + (b[1] - a[1]) * t;
  const c = mode.character;
  c.position.x = x;
  c.position.z = z;
  c.position.y = model.floorAt(x, z);
  follow.yaw = Math.atan2(b[0] - a[0], -(b[1] - a[1]));
}

// --- Loop -------------------------------------------------------------------------------------
const frameTimes: number[] = [];
let frameMsAvg = 16;
let hudTimer = 0;
const focus = new THREE.Vector3();
const loop = createLoop(
  {
    tick(dt) {
      if (!editor.active) machine.update(dt);
      input.endTick();
      stepGuards(dt);
    },
    frame(alpha, frameSeconds) {
      if (bench) benchCamera(frameSeconds);
      const c = mode.character;
      const p = mode.previous;
      const x = p.position.x + (c.position.x - p.position.x) * alpha;
      const y = p.position.y + (c.position.y - p.position.y) * alpha;
      const z = p.position.z + (c.position.z - p.position.z) * alpha;
      scene.setTime(state.environment.clock.gameSeconds);
      if (editor.active) {
        editor.frame(frameSeconds);
        focus.set(editor.target.x, editor.target.y, editor.target.z);
      } else {
        const { dx, dy } = look.consume();
        follow.look(dx, dy);
        follow.update({ x, y, z }, c.crouching, zone, frameSeconds);
        scene.camera.position.set(follow.position.x, follow.position.y, follow.position.z);
        scene.camera.lookAt(follow.target.x, follow.target.y, follow.target.z);
        focus.set(x, y, z);
      }
      scene.setPlayer(x, y, z, c.heading, c.crouching, true);
      scene.setGuards(wanderers);
      scene.render(focus);

      frameTimes.push(frameSeconds * 1000);
      if (frameTimes.length > 600) frameTimes.shift();
      frameMsAvg += (frameSeconds * 1000 - frameMsAvg) * 0.05;
      hudTimer += frameSeconds;
      if (hudTimer < 0.25) return;
      hudTimer = 0;
      const { hour: h } = dayAndHour(state.environment.clock.gameSeconds);
      const hh = Math.floor(h);
      const mm = Math.floor((h - hh) * 60);
      const info = scene.renderer.info.render;
      const inside = model.buildingAt(x, y, z);
      const door = model.doors.find((d) => Math.hypot(d.x - x, d.z - z) < 1.6);
      const stale = nav && nav.data.layoutHash !== layoutHash(layout);
      hud.textContent = [
        `${def.name}  ${editor.active ? '(editing: Tab to walk)' : look.locked ? '' : '(click to look)'}`,
        editor.active
          ? editor.help
          : 'WASD move · Shift run · C crouch · Space hop · T/Shift+T hour · N navmesh · G guards · O fog · Tab edit',
        ``,
        `frame ${frameMsAvg.toFixed(1)} ms · ${info.calls} calls · ${(info.triangles / 1000).toFixed(0)}k tris · ${scene.view.meshes} meshes`,
        `clock ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')} · night ${scene.night.toFixed(2)} · moonlight ${(scene.moonPhase * 100).toFixed(0)}%`,
        `pos ${x.toFixed(1)}, ${y.toFixed(2)}, ${z.toFixed(1)} · ${c.gait} on ${model.surfaceAt(x, y, z)}${inside ? ` · inside ${inside.def.name ?? inside.def.id}` : ''}`,
        door ? `door ${door.id}${door.opens ? ` → opens ${door.opens}` : ''}` : '',
        `colliders ${model.colliders.size} · lamps ${model.lamps.length} · doors ${model.doors.length}`,
        nav
          ? `navmesh ${nav.polyCount} polys${stale ? ' · STALE: run npm run district:bake' : ''} · guards ${wanderers.length}${pathCount ? ` · ${(pathMs / pathCount).toFixed(3)} ms/path` : ''}`
          : 'navmesh missing: npm run district:bake',
      ]
        .filter((l) => l !== '')
        .join('\n');
      document.body.dataset['ready'] = '1';
    },
  },
  new FixedStepper(GAMEPLAY_TICK_HZ),
);
loop.start();

// For Playwright and the console.
Object.assign(window, {
  district: {
    get model() {
      return model;
    },
    get nav() {
      return nav;
    },
    mode,
    follow,
    scene,
    editor,
    state,
    frameTimes,
    get pathStats() {
      return { pathMs, pathCount };
    },
    setGuards,
  },
});
