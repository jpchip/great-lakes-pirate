import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { knotsToMs } from '../src/core/coords';
import {
  createSailingState,
  IDLE_COMMAND,
  speedKn,
  stepSailing,
  type SailingCommand,
  type SailingState,
  type SailingWind,
} from '../src/sim/sailing/controller';
import { defaultHandling } from '../src/sim/sailing/handling';
import { defaultHazardRules } from '../src/sim/sailing/hazard-rules';
import {
  applyJibe,
  compileHazardClass,
  createHazardState,
  IDLE_MOORING,
  mooringBerths,
  stepHazards,
  type HazardClass,
  type HazardEnv,
  type HazardEvent,
  type HazardState,
  type HazardTerrain,
  type MooringCommand,
} from '../src/sim/sailing/hazards';
import { compileSailingClass } from '../src/sim/sailing/ship-class';
import { sailShipRecord, T1_SCHOONER_ID } from '../src/sim/sailing/ships';
import { loadZoneTerrain, type LoadedZone } from '../src/sim/terrain/load';
import { TEST_BAY, type Dock } from '../src/sim/terrain/test-bay';
import { APOSTLES_ID, spawnPose, zoneDef } from '../src/sim/terrain/zones';

const DEG = Math.PI / 180;
const DT = 1 / 30;
const SCALE = { rate: 24, compression: 8 };
const record = sailShipRecord(T1_SCHOONER_ID);
const sailing = compileSailingClass(record, defaultHandling());
const t1 = (): HazardClass => compileHazardClass(record, defaultHazardRules());
const wind = (fromDeg: number, speedKn: number, gust01 = 0): SailingWind => ({
  fromRad: fromDeg * DEG,
  speedKn,
  gust01,
});

interface Rig {
  s: SailingState;
  h: HazardState;
  c: HazardClass;
  env: HazardEnv;
  events: HazardEvent[];
}

function rig(
  x: number,
  z: number,
  headingDeg: number,
  opts: { sail?: number; speedKn?: number; terrain?: HazardTerrain; docks?: Dock[] } = {},
): Rig {
  const s = createSailingState(x, z, headingDeg * DEG);
  s.sailLevel = s.sailSetting = opts.sail ?? 0;
  s.speed = knotsToMs(opts.speedKn ?? 0);
  const c = t1();
  const docks = opts.docks ?? [];
  return {
    s,
    h: createHazardState(c),
    c,
    env: { terrain: opts.terrain, docks, berths: mooringBerths(docks) },
    events: [],
  };
}

/** Sails and runs hazards for `seconds`, like the sailing mode's tick. */
function run(
  r: Rig,
  seconds: number,
  w: SailingWind,
  helm: Partial<SailingCommand> = {},
  moor: Partial<MooringCommand> = {},
): Rig {
  const cmd = { ...IDLE_COMMAND, ...helm };
  const mc = { ...IDLE_MOORING, ...moor };
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    const prev = { x: r.s.x, z: r.s.z, heading: r.s.heading };
    stepSailing(r.s, cmd, sailing, w, 0, SCALE, DT);
    stepHazards(r.s, r.h, r.c, mc, r.env, prev, w, SCALE, DT, r.events);
    // Edge-triggered orders only count on the first tick.
    cmd.raiseSail = cmd.lowerSail = false;
    mc.interact = false;
  }
  return r;
}

const kinds = (r: Rig): string[] => r.events.map((e) => e.kind);

/** A gentle beach: 20 m deep at x ≤ 0, shoaling 1 m per 20 m eastward. */
const beach: HazardTerrain = { depthAt: (x) => Math.max(0, 20 - Math.max(0, x) * 0.05) };
/** A cliff: 20 m deep up to x = 100, then a wall rising 2 m per meter. */
const cliff: HazardTerrain = {
  depthAt: (x) => (x < 100 ? 20 : Math.max(0, 20 - (x - 100) * 2)),
};

describe('grounding', () => {
  it('sticks fast on a shoal at low speed, with minor damage', () => {
    const r = rig(350, 0, 90, { speedKn: 1.5, terrain: beach });
    run(r, 20, wind(0, 0));
    expect(r.h.aground).toBe(true);
    const grounded = r.events.find((e) => e.kind === 'grounded');
    expect(grounded).toMatchObject({ hard: false, damage: 2 });
    expect(r.h.hull).toBe(98);
    // Stuck: the sails can't drive it on and the rudder can't turn it.
    const { x, heading } = r.s;
    run(r, 10, wind(270, 14), { steer: 1, raiseSail: true });
    expect(r.s.x).toBe(x);
    expect(r.s.heading).toBe(heading);
    expect(r.s.speed).toBe(0);
  });

  it('damages the hull by speed when it runs aground hard', () => {
    const r = rig(320, 0, 90, { sail: 3, speedKn: 6, terrain: beach });
    run(r, 10, wind(0, 14));
    const grounded = r.events.find((e) => e.kind === 'grounded');
    if (grounded?.kind !== 'grounded') throw new Error('did not ground');
    expect(grounded.hard).toBe(true);
    expect(grounded.speedKn).toBeGreaterThan(5);
    expect(grounded.damage).toBeCloseTo(5 * grounded.speedKn, 6);
  });

  it('kedges off to deeper water while X is held', () => {
    const r = rig(350, 0, 90, { speedKn: 2, terrain: beach });
    run(r, 10, wind(0, 0));
    expect(r.h.aground).toBe(true);
    run(r, 30, wind(0, 0), {}, { anchor: true });
    expect(kinds(r)).toContain('refloated');
    expect(r.h.aground).toBe(false);
    expect(r.h.depth).toBeGreaterThanOrEqual(r.h.draft);
    // Kedging doesn't count as dropping the anchor.
    expect(r.h.anchor).toBe('up');
  });

  it('reads shallow water at under twice the draft', () => {
    const r = rig(0, 0, 90, { terrain: beach });
    run(r, 0.1, wind(0, 0));
    expect(r.h.shallow).toBe(false);
    const near = rig(340, 0, 90, { terrain: beach });
    run(near, 0.1, wind(0, 0));
    expect(near.h.depth).toBeLessThan(3);
    expect(near.h.shallow).toBe(true);
  });

  it('runs a laden or leaking ship aground in deeper water', () => {
    const r = rig(0, 0, 90);
    r.h.cargo01 = 1;
    r.h.hull = 0;
    run(r, 0.1, wind(0, 0));
    expect(r.h.draft).toBeCloseTo(record.draftFullM + 0.4, 6);
  });
});

describe('rock and pier hits', () => {
  it('bounces off a steep shore with heavy damage instead of sticking', () => {
    const r = rig(70, 0, 90, { speedKn: 6, terrain: cliff });
    run(r, 8, wind(0, 0));
    const struck = r.events.find((e) => e.kind === 'struck');
    if (struck?.kind !== 'struck') throw new Error('no strike');
    expect(struck.what).toBe('rock');
    expect(struck.speedKn).toBeGreaterThan(2.5);
    expect(struck.damage).toBeCloseTo(10 * struck.speedKn, 6);
    expect(r.h.aground).toBe(false);
    expect(r.s.speed).toBeLessThanOrEqual(0);
    expect(r.h.depth).toBeGreaterThan(r.h.draft);
  });

  it('only scrapes when it eases onto the rock', () => {
    const r = rig(85, 0, 90, { speedKn: 0.3, terrain: cliff });
    run(r, 10, wind(0, 0));
    expect(kinds(r)).not.toContain('struck');
    expect(r.h.hull).toBe(100);
  });

  it('is pushed clear of a pier it sails into', () => {
    const dock: Dock = {
      id: 'dock.test',
      name: 'Test',
      root: { x: 0, z: 0 },
      bearing: 90 * DEG,
      lengthM: 60,
      widthM: 6,
      deckM: 1.6,
    };
    // Heading north toward the pier's south side, at 3 kn.
    const r = rig(30, 25, 0, { speedKn: 3, docks: [dock] });
    run(r, 4, wind(0, 0));
    const struck = r.events.find((e) => e.kind === 'struck');
    expect(struck).toMatchObject({ what: 'pier' });
    // The midships probe keeps its half beam off the deck's edge.
    expect(r.s.z).toBeGreaterThanOrEqual(3 + r.c.halfBeamM - 0.01);
  });
});

describe('damage effects', () => {
  it('slows a leaking ship and slows sail work with torn rigging', () => {
    const r = rig(0, 0, 90);
    r.h.hull = 50;
    r.h.rigging = 0;
    run(r, DT, wind(0, 0));
    expect(r.s.loadFactor).toBeCloseTo(1 - 0.3 * 0.5, 6);
    expect(r.s.riggingCondition).toBeCloseTo(0.5, 6);
    expect(r.s.sailChangeScale).toBeCloseTo(2, 6);
    // One sail step now takes twice the solo T1's 4 s.
    run(r, 4, wind(0, 14), { raiseSail: true });
    expect(r.s.sailSetting).toBeCloseTo(0.5, 1);
  });

  it('tears rigging on an uncontrolled jibe only', () => {
    const h = createHazardState(t1());
    applyJibe(h, t1(), false);
    expect(h.rigging).toBe(80);
    applyJibe(h, t1(), true);
    expect(h.rigging).toBe(72);
  });

  it('founders once when the hull reaches 0', () => {
    const r = rig(60, 0, 90, { speedKn: 8, terrain: cliff });
    r.h.hull = 10;
    run(r, 8, wind(0, 0));
    expect(r.h.hull).toBe(0);
    expect(r.h.foundering).toBe(true);
    expect(kinds(r).filter((k) => k === 'foundering')).toHaveLength(1);
  });
});

describe('overpressing and knockdown', () => {
  // A beam reach with the wind from the north and the ship heading east.
  const beam = (sail: number, kn: number, seconds = 60, gust01 = 0): Rig =>
    run(rig(0, 0, 90, { sail }), seconds, wind(0, kn, gust01));

  it('carries Full sail in moderate wind with no strain', () => {
    const r = beam(3, 16);
    expect(r.h.strain).toBe(0);
    expect(r.h.rigging).toBe(80);
  });

  it('warns at Full in a strong breeze before it starts to tear', () => {
    const r = beam(3, 22);
    expect(r.h.strain).toBeCloseTo(3 / 8, 2);
    expect(r.h.rigging).toBe(80);
  });

  it('tears the rigging when overpressed past the threshold', () => {
    const r = beam(3, 25);
    expect(r.h.strain).toBeGreaterThan(0.6);
    expect(r.h.rigging).toBeLessThan(80);
    expect(kinds(r)).not.toContain('knockdown');
  });

  it('knocks the ship down in a gale at Full, and not when reefed (the gale criterion)', () => {
    const full = beam(3, 32, 30);
    expect(kinds(full)).toContain('knockdown');
    expect(full.h.rigging).toBeLessThan(80 * 0.7);
    expect(full.h.hull).toBeLessThanOrEqual(90);

    const reefed = beam(1, 32, 30);
    expect(reefed.h.strain).toBe(0);
    expect(reefed.h.rigging).toBe(80);
    expect(reefed.h.hull).toBe(100);
  });

  it('knocks the ship down at Half when gusts overpress it', () => {
    const r = beam(2, 30, 30, 1);
    expect(kinds(r)).toContain('knockdown');
  });

  it('lurches far over, then recovers', () => {
    const r = rig(0, 0, 90, { sail: 3 });
    let peak = 0;
    for (let t = 0; t < 30; t += 0.5) {
      run(r, 0.5, wind(0, 32));
      if (r.h.knockdown > 0) peak = Math.max(peak, Math.abs(r.s.heel));
    }
    expect(peak).toBeGreaterThan(45 * DEG);
    expect(kinds(r).filter((k) => k === 'knockdown')).toHaveLength(1);
    run(r, 10, wind(0, 32), { lowerSail: true });
    expect(r.h.knockdown).toBe(0);
    expect(Math.abs(r.s.heel)).toBeLessThan(20 * DEG);
  });

  it('carries no strain while luffing in irons', () => {
    const r = run(rig(0, 0, 0, { sail: 3 }), 2, wind(0, 32));
    expect(r.s.inIrons).toBe(true);
    expect(r.h.strain).toBe(0);
  });
});

describe('anchoring', () => {
  const flat = (depth: number): HazardTerrain => ({ depthAt: () => depth });

  it('needs X held, then stops the ship over a few seconds and swings it head to wind', () => {
    const r = rig(0, 0, 90, { speedKn: 4, terrain: flat(8) });
    run(r, 0.3, wind(0, 12), {}, { anchor: true });
    expect(r.h.anchor).toBe('up');
    run(r, 0.3, wind(0, 12), {}, { anchor: true });
    expect(r.h.anchor).toBe('down');
    expect(kinds(r)).toEqual(['anchorDropped']);
    // Holding X on doesn't weigh it again.
    run(r, 2, wind(0, 12), {}, { anchor: true });
    expect(r.h.anchor).toBe('down');
    run(r, 15, wind(0, 12));
    expect(Math.abs(speedKn(r.s))).toBeLessThan(0.3);
    expect(Math.abs(r.s.heading)).toBeLessThan(5 * DEG);
    // It lies downwind (south) of the anchor.
    expect(r.s.z - r.h.anchorZ).toBeGreaterThan(r.c.rules.anchorSwingM - 2);
    expect(r.s.z - r.h.anchorZ).toBeLessThan(r.c.rules.anchorSwingM + 3);
    expect(Math.abs(r.s.x - r.h.anchorX)).toBeLessThan(2);
  });

  it('refuses water deeper than the rode', () => {
    const r = rig(0, 0, 90, { terrain: flat(45) });
    run(r, 1, wind(0, 12), {}, { anchor: true });
    expect(r.h.anchor).toBe('up');
    expect(r.events).toEqual([{ kind: 'anchorRefused', reason: 'tooDeep' }]);
  });

  it('weighs anchor over a few seconds', () => {
    const r = rig(0, 0, 90, { terrain: flat(8) });
    run(r, 1, wind(0, 12), {}, { anchor: true });
    run(r, 0.1, wind(0, 12));
    run(r, 1, wind(0, 12), {}, { anchor: true });
    expect(r.h.anchor).toBe('weighing');
    run(r, 4, wind(0, 12));
    expect(r.h.anchor).toBe('weighing');
    run(r, 2, wind(0, 12));
    expect(r.h.anchor).toBe('up');
    expect(kinds(r)).toContain('anchorWeighed');
  });

  it('drags in a gale in open water and holds in a sheltered lee', () => {
    const gale = rig(0, 0, 0, { terrain: flat(20) });
    run(gale, 1, wind(0, 34), {}, { anchor: true });
    const dropped = gale.h.anchorZ;
    run(gale, 30, wind(0, 34));
    expect(gale.h.dragging).toBe(true);
    expect(kinds(gale)).toContain('anchorDragging');
    // Dragged downwind (south).
    expect(gale.h.anchorZ).toBeGreaterThan(dropped + 10);

    // The lee takes the wind down to 15 kn: the same anchor holds.
    const lee = rig(0, 0, 0, { terrain: flat(20) });
    run(lee, 1, wind(0, 15), {}, { anchor: true });
    const at = lee.h.anchorZ;
    run(lee, 30, wind(0, 15));
    expect(lee.h.dragging).toBe(false);
    expect(lee.h.anchorZ).toBe(at);
  });

  it('can drag the ship onto a lee shore', () => {
    // Shoaling to the south, downwind of a north gale.
    const shore: HazardTerrain = { depthAt: (_x, z) => Math.max(0, 25 - Math.max(0, z) * 0.1) };
    const r = rig(0, 0, 0, { terrain: shore });
    run(r, 1, wind(0, 40), {}, { anchor: true });
    run(r, 240, wind(0, 40));
    expect(kinds(r)).toContain('grounded');
  });
});

describe('docking', () => {
  const dock: Dock = {
    id: 'dock.test',
    name: 'Test',
    root: { x: 0, z: 0 },
    bearing: 90 * DEG,
    lengthM: 56,
    widthM: 6,
    deckM: 1.6,
  };
  const berths = mooringBerths([dock]);
  const north = berths.find((b) => b.id === 'dock.test.north');
  if (!north) throw new Error('no berth');

  it('lays out berths on both sides with their away directions', () => {
    expect(berths).toHaveLength(2);
    // North berth: away is north (−z).
    expect(north.awayZ).toBeCloseTo(-1, 6);
    expect(north.pose.z).toBeCloseTo(-6.5, 6);
  });

  it('lays berths down a long pier, clear of a wide deck, and drops the shallow ones', () => {
    const long: Dock = { ...dock, id: 'dock.long', lengthM: 160, widthM: 16 };
    const all = mooringBerths([long]);
    // Pairs every 36 m from the end while the berth stays 10 m off the root.
    expect(all.map((b) => b.id)).toEqual([
      'dock.long.north',
      'dock.long.south',
      'dock.long.north2',
      'dock.long.south2',
      'dock.long.north3',
      'dock.long.south3',
      'dock.long.north4',
      'dock.long.south4',
    ]);
    // Half the deck plus 3.5 m off the centerline.
    expect(all[0]?.pose.z).toBeCloseTo(-11.5, 6);
    // Water shoaling to 2 m within 60 m of the root keeps only the outer berths.
    const shoal: HazardTerrain = { depthAt: (x) => (x < 60 ? 2 : 10) };
    expect(mooringBerths([long], shoal).map((b) => b.id)).toEqual([
      'dock.long.north',
      'dock.long.south',
      'dock.long.north2',
      'dock.long.south2',
      'dock.long.north3',
      'dock.long.south3',
    ]);
  });

  it('brings a slow ship alongside with F and furls the sails', () => {
    const r = rig(north.pose.x - 8, north.pose.z - 10, 60, {
      sail: 1,
      speedKn: 1.5,
      docks: [dock],
    });
    run(r, 0.1, wind(0, 12), {}, { interact: true });
    expect(r.h.mooring).toBe('docking');
    expect(r.s.sailLevel).toBe(0);
    run(r, 5, wind(0, 12));
    expect(r.h.mooring).toBe('docked');
    expect(r.events).toContainEqual({ kind: 'docked', berthId: north.id });
    expect(r.s.x).toBeCloseTo(north.pose.x, 6);
    expect(r.s.z).toBeCloseTo(north.pose.z, 6);
    expect(r.s.heading).toBeCloseTo(north.pose.heading, 6);
    // It stays put while docked, even in a breeze with sail ordered.
    run(r, 10, wind(270, 20), { raiseSail: true });
    expect(r.s.x).toBeCloseTo(north.pose.x, 6);
    expect(r.h.strain).toBe(0);
    expect(r.h.hull).toBe(100);
  });

  it('refuses when too fast, too far, or at anchor', () => {
    const fast = rig(north.pose.x, north.pose.z - 5, 90, { speedKn: 4, docks: [dock] });
    run(fast, DT, wind(0, 12), {}, { interact: true });
    expect(fast.events).toContainEqual({ kind: 'dockRefused', reason: 'tooFast' });

    const far = rig(200, 200, 90, { docks: [dock] });
    run(far, DT, wind(0, 12), {}, { interact: true });
    expect(far.events).toContainEqual({ kind: 'dockRefused', reason: 'noBerth' });

    const anchored = rig(north.pose.x, north.pose.z - 5, 90, {
      docks: [dock],
      terrain: { depthAt: () => 10 },
    });
    run(anchored, 1, wind(0, 12), {}, { anchor: true });
    run(anchored, DT, wind(0, 12), {}, { interact: true });
    expect(anchored.events).toContainEqual({ kind: 'dockRefused', reason: 'anchored' });
  });

  it('casts off with a push ahead and away from the pier', () => {
    const r = rig(north.pose.x, north.pose.z, 90, { docks: [dock] });
    run(r, DT, wind(0, 0), {}, { interact: true });
    run(r, 6, wind(0, 0));
    expect(r.h.mooring).toBe('docked');
    run(r, DT, wind(0, 0), {}, { interact: true });
    expect(r.h.mooring).toBe('castingOff');
    expect(speedKn(r.s)).toBeCloseTo(1, 1);
    run(r, 4, wind(0, 0));
    expect(r.h.mooring).toBe('free');
    expect(r.s.z).toBeLessThan(north.pose.z - 2.5);
    expect(r.s.x).toBeGreaterThan(north.pose.x + 3);
    expect(kinds(r)).not.toContain('struck');
  });
});

describe('test bay hazards', () => {
  const dir = join(__dirname, '..', 'public', 'world', 'apostles');
  const baked =
    existsSync(join(dir, 'manifest.json')) &&
    readFileSync(join(dir, 'height', '0-0.bin')).byteLength > 200;
  let zone: LoadedZone;

  beforeAll(async () => {
    if (!baked) return;
    zone = await loadZoneTerrain(async (path) => new Uint8Array(readFileSync(join(dir, path))));
  });

  it.skipIf(!baked)('sails clear at the spawn but too deep to anchor', () => {
    const spawn = spawnPose(zoneDef(APOSTLES_ID));
    const r = rig(spawn.x, spawn.z, spawn.heading / DEG, { terrain: zone.terrain });
    run(r, 1, wind(270, 12), {}, { anchor: true });
    expect(r.h.aground).toBe(false);
    expect(r.h.shallow).toBe(false);
    expect(r.events).toContainEqual({ kind: 'anchorRefused', reason: 'tooDeep' });
  });

  it.skipIf(!baked)('docks at Bayfield from a slow approach', () => {
    const docks = [...TEST_BAY.docks];
    const r = rig(-800, 320, 270, { speedKn: 1.5, terrain: zone.terrain, docks });
    const berth = r.env.berths[0];
    if (!berth) throw new Error('no berth');
    r.s.x = berth.pose.x + 10;
    r.s.z = berth.pose.z;
    run(r, DT, wind(270, 12), {}, { interact: true });
    run(r, 6, wind(270, 12));
    expect(r.h.mooring).toBe('docked');
    expect(r.h.aground).toBe(false);
    expect(r.h.depth).toBeGreaterThan(5);
  });

  it.skipIf(!baked)('touches bottom sailing at the Bayfield shore', () => {
    // Off the dock's south side, heading west into the shore at a reach in a north wind.
    const r = rig(-840, 400, 270, { sail: 3, speedKn: 6, terrain: zone.terrain });
    run(r, 30, wind(0, 14));
    const hit = r.events.find((e) => e.kind === 'grounded' || e.kind === 'struck');
    expect(hit).toBeDefined();
    expect(r.h.hull).toBeLessThan(100);
    // Wherever it ended up, the keel isn't in the land.
    expect(r.h.depth).toBeGreaterThan(0);
  });
});
