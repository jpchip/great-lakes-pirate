import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { createGreyboxDistrict } from '../src/debug/stealth-greybox/district';
import type { DistrictLamp } from '../src/gameplay/district/district';
import { ColliderSet } from '../src/gameplay/onfoot/colliders';
import {
  createCharacter,
  DEFAULT_CONTROLLER,
  stepCharacter,
  type OnFootZone,
} from '../src/gameplay/onfoot/controller';
import { lightLamps } from '../src/gameplay/onfoot/district-guards';
import { douse, douseOffer, GAS_HOLD_S, LANTERN_HOLD_S } from '../src/gameplay/onfoot/douse';
import { gameNpcs, type GuardSpawn } from '../src/gameplay/onfoot/guards';
import { Heightfield } from '../src/gameplay/onfoot/heightfield';
import { createLean, LEAN_M, stepLean } from '../src/gameplay/onfoot/lean';
import { LampSet, lightAt, type Lamp } from '../src/gameplay/onfoot/light';
import { look, type Figure } from '../src/gameplay/onfoot/perception';
import {
  createStealth,
  RELIGHT_S,
  type StealthEvent,
  type StealthInputs,
} from '../src/gameplay/onfoot/stealth';
import type { SkyLight } from '../src/sim/law/perception';

const DT = 1 / 60;
const DEG = Math.PI / 180;
const NEW_MOON: SkyLight = {
  sunElevationRad: -40 * DEG,
  moonElevationRad: 45 * DEG,
  moonIllumination01: 0,
  cloud01: 0,
};

function flat(colliders = new ColliderSet()): OnFootZone {
  const n = 81;
  return {
    ground: new Heightfield(n, n, 1, -40, -40, new Float32Array(n * n)),
    colliders,
    waterLevel: -10,
  };
}

/** A wall 4 m long along z, its west face at x = 0.5, from z = −4 to 0 (a corner at z = 0). */
function corner(): ColliderSet {
  const c = new ColliderSet();
  c.add({ kind: 'box', x: 1, z: -2, halfX: 0.5, halfZ: 2, yaw: 0, minY: 0, maxY: 3 });
  return c;
}

function standing(zone: OnFootZone, x: number, z: number) {
  const c = createCharacter({ x, y: 0, z }, 0);
  for (let k = 0; k < 10; k++) {
    stepCharacter(c, { forward: 0, right: 0, run: false, crouch: false }, 0, zone, DT);
  }
  return c;
}

describe('lean and peek (Q/E)', () => {
  it('goes out to the side of the view while you stand still, and back when you move', () => {
    const zone = flat();
    const c = standing(zone, 0, 0);
    const l = createLean();
    // Facing north (yaw 0), E leans to the east (+x).
    for (let t = 0; t < 0.5; t += DT) stepLean(l, 1, c, false, true, 0, zone, 1.75, DT);
    expect(l.amount).toBe(1);
    expect(l.offsetX).toBeCloseTo(LEAN_M, 5);
    expect(Math.abs(l.offsetZ)).toBeLessThan(1e-9);
    // Facing east, Q leans north (−z).
    for (let t = 0; t < 1; t += DT) stepLean(l, -1, c, false, true, Math.PI / 2, zone, 1.75, DT);
    expect(l.offsetZ).toBeCloseTo(-LEAN_M, 5);
    // A step straightens you up.
    for (let t = 0; t < 0.5; t += DT) stepLean(l, -1, c, true, true, Math.PI / 2, zone, 1.75, DT);
    expect(l.amount).toBe(0);
    expect(l.offsetX).toBe(0);
  });

  it('stops short of a wall, and not at all with your arms full', () => {
    const zone = flat(corner());
    // Against the wall's west face, leaning east into it.
    const c = standing(zone, 0.2, -2);
    const l = createLean();
    for (let t = 0; t < 0.5; t += DT) stepLean(l, 1, c, false, true, 0, zone, 1.75, DT);
    expect(l.offsetX).toBeLessThan(0.25);
    const full = createLean();
    for (let t = 0; t < 0.5; t += DT) stepLean(full, 1, c, false, false, 0, zone, 1.75, DT);
    expect(full.amount).toBe(0);
  });

  it('peeking round a corner shows a guard your head, and only your head', () => {
    // You stand behind the wall's south end; the guard is east of the wall, looking west.
    const colliders = corner();
    const zone = flat(colliders);
    const c = standing(zone, 0.1, 0.4);
    const l = createLean();
    // Looking north along the wall, lean east round its end.
    for (let t = 0; t < 0.5; t += DT) stepLean(l, 1, c, false, true, 0, zone, 1.75, DT);
    expect(l.offsetX).toBeGreaterThan(0.45);
    const f = (lean: boolean): Figure => ({
      x: c.position.x,
      y: c.position.y,
      z: c.position.z,
      gait: 'idle',
      crouching: false,
      swimming: false,
      carrying: false,
      height: DEFAULT_CONTROLLER.standHeight,
      ...(lean ? { leanX: l.offsetX, leanZ: l.offsetZ } : {}),
    });
    const glimpse = (lean: boolean) =>
      look({
        eye: { x: 8, y: 1.6, z: -3 },
        eyeHeading: -Math.PI / 2,
        sight: { rangeM: 22, fovDeg: 100, peripheralDeg: 200 },
        rangeFactor: 1,
        figure: f(lean),
        exposure01: 0.9,
        colliders,
        lamps: new LampSet(),
        carried: [],
      });
    expect(glimpse(false).seen).toBe(false);
    const peek = glimpse(true);
    expect(peek.seen).toBe(true);
    expect(peek.cover01).toBeCloseTo(1 / 3, 5);
  });
});

describe('dousing a lamp', () => {
  const gas = (x: number, z: number): Lamp => ({
    x,
    y: 3.2,
    z,
    radiusM: 9,
    intensity: 1,
    lit: true,
  });
  const def = (piece: string): DistrictLamp => ({
    id: 'lamp',
    piece,
    x: 0,
    y: 3.2,
    z: 0,
    radiusM: 9,
    intensity: 1,
    color: '#ffc46b',
  });

  it('F at the foot of a lit lamp: the gas turned down, a lantern blown out', () => {
    const lamps = [gas(0, 0), { ...gas(5, 0), y: 2 }];
    const defs = [def('kit.gas_lamp'), def('kit.lantern_post')];
    expect(douseOffer(lamps, defs, { x: 0.8, y: 0, z: 0 })).toMatchObject({
      lamp: 0,
      label: 'Turn down the gas lamp',
      holdS: GAS_HOLD_S,
    });
    expect(douseOffer(lamps, defs, { x: 5.5, y: 0, z: 0 })).toMatchObject({
      lamp: 1,
      label: 'Blow out the lantern',
      holdS: LANTERN_HOLD_S,
    });
    // Out of reach, or up on a roof above it, or by day.
    expect(douseOffer(lamps, defs, { x: 2.5, y: 0, z: 0 })).toBeUndefined();
    expect(douseOffer(lamps, defs, { x: 0.5, y: 3.5, z: 0 })).toBeUndefined();
    expect(douseOffer([{ ...gas(0, 0), lit: false }], defs, { x: 0, y: 0, z: 0 })).toBeUndefined();
  });

  it('a doused lamp gives no light and stays dark through the night; dawn forgets it', () => {
    const l = gas(0, 0);
    const set = new LampSet([l]);
    lightLamps([l], 0.04);
    const lit = lightAt(0, 0, 0, 0.04, set).level01;
    douse(l);
    lightLamps([l], 0.04);
    expect(l.lit).toBe(false);
    expect(lightAt(0, 0, 0, 0.04, set).level01).toBeLessThan(lit * 0.1);
    lightLamps([l], 0.9);
    expect(l.doused).toBe(false);
    lightLamps([l], 0.04);
    expect(l.lit).toBe(true);
  });

  function street(type: string) {
    const d = createGreyboxDistrict();
    const target = d.lamps.lamps.find((l) => l.x === -28 && l.z === -20);
    if (!target) throw new Error('No street lamp at -28');
    const guards: GuardSpawn[] = [
      {
        id: 'g',
        type,
        route: { loop: false, points: [{ x: -40, z: -18, waitS: 999, face: Math.PI / 2 }] },
      },
    ];
    const stealth = createStealth(
      { zone: d, nav: d.nav, lamps: d.lamps, rng: Rng.fromSeed('douse'), lawPost: d.lawPost },
      gameNpcs(),
      guards,
      0,
    );
    const events: StealthEvent[] = [];
    stealth.on((e) => events.push(e));
    const player = createCharacter({ x: 30, y: 1.5, z: 30 }, 0);
    const inputs: StealthInputs = {
      player,
      sky: NEW_MOON,
      fogM: 20000,
      rain01: 0,
      gameSeconds: 23 * 3600,
      suspect: false,
      fame01: 0,
      wantedTier: 0,
    };
    const wait = (s: number): void => {
      for (let t = 0; t < s; t += DT) {
        inputs.gameSeconds += DT * 6;
        stealth.step(DT, inputs);
      }
    };
    return { stealth, target, events, wait };
  }

  it('a guard on his round sees it out, walks over and lights it again', () => {
    const r = street('npc.watchman');
    r.wait(0.5);
    douse(r.target);
    r.wait(0.5);
    const g = r.stealth.guard('g');
    expect(g?.state).toBe('distracted');
    expect(g?.relight).toBe(r.target);
    r.wait(12 + RELIGHT_S);
    expect(r.target.doused).toBe(false);
    expect(r.target.lit).toBe(true);
    expect(r.events.some((e) => e.type === 'LampRelit' && e.npc === 'g')).toBe(true);
    // No alarm over a lamp.
    expect(r.events.some((e) => e.type === 'PlayerSpotted')).toBe(false);
  });

  it('a sailor on deck watch leaves it be', () => {
    const r = street('npc.sailor');
    r.wait(0.5);
    douse(r.target);
    r.wait(6);
    expect(r.stealth.guard('g')?.state).toBe('patrol');
    expect(r.target.doused).toBe(true);
  });
});
