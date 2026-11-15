import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import bayfieldJson from '../data/districts/bayfield.json';
import districtsJson from '../data/districts.json';
import { districtsFileSchema } from '../data/schemas/districts';
import { buildDistrict } from '../src/gameplay/district/district';
import { DistrictNav } from '../src/gameplay/district/district-nav';
import { decodeGround } from '../src/gameplay/district/ground';
import { createCharacter } from '../src/gameplay/onfoot/controller';
import { nextDawn } from '../src/gameplay/onfoot/foot-law';
import { nightOf, type Crate } from '../src/gameplay/onfoot/heist';
import {
  bottlesFor,
  cabinTable,
  crewEvidence,
  crewFigures,
  crewInSaloon,
  crewTables,
  holdTable,
  MAX_MOORED,
  placeMoored,
  shipWords,
  type CrewDrunk,
  type MooredInput,
} from '../src/gameplay/onfoot/moored';
import { gameTools, type Pockets } from '../src/gameplay/onfoot/tools';
import { createWatch } from '../src/gameplay/onfoot/watch';
import { lawWorld } from '../src/gameplay/law';
import { NavMesh, type NavMeshData } from '../src/sim/district/navmesh';
import { parseLayout } from '../src/sim/district/layout';
import { gameLaw } from '../src/sim/law/defs';
import { addWitness, commitCrime, type CrimeInput } from '../src/sim/law/law';
import { createWorldState, type DistrictWorld } from '../src/sim/world-state';

/**
 * Phase 7 piece F, part two (plan 08 §6.2, §20.3 #4): ships moored at Bayfield's piers,
 * their deck watch, hold and cabin, and the whiskey trick on their crews. On the real
 * district with its baked ground, like heist.test.ts.
 */

const dir = join(import.meta.dirname, '..', 'public', 'districts', 'bayfield');
const groundPath = join(dir, 'ground.bin');
const baked = existsSync(groundPath) && readFileSync(groundPath).byteLength > 200;

const DT = 1 / 60;
const DAY = 160 * 86400;
/** Eight in the evening, eleven at night and noon on a June day. */
const EVENING = DAY + 20 * 3600;
const NIGHT = DAY + 23 * 3600;
const NOON = DAY + 12 * 3600;
const REGION = 'region.apostles';
const rules = gameTools().file;
const def = districtsFileSchema.parse(districtsJson)[0];

/** The supply tug as the traffic lays her on the fish pier's east side, bow out. */
const WREN: MooredInput = {
  id: 'ship.la_pointe_supply_1',
  name: 'Supply tug Wren',
  className: 'Supply tug',
  owner: 'company.northland_packet',
  crew: 5,
  cargo: [
    { good: 'good.flour', qty: 8 },
    { good: 'good.salt', qty: 4 },
  ],
  x: -32.45,
  z: -65,
  heading: 0,
  lengthM: 21,
  beamM: 4.5,
};
/** A fish tug on the west side, in ballast. */
const LUND: MooredInput = {
  ...WREN,
  id: 'ship.fish_apostles_2',
  name: 'Fish tug Iver Lund',
  className: 'Fish tug',
  owner: 'company.hollister_fish',
  cargo: [],
  x: -47.55,
};

function load() {
  const model = buildDistrict(
    parseLayout(structuredClone(bayfieldJson)),
    decodeGround(new Uint8Array(readFileSync(groundPath))),
  );
  const mesh = new NavMesh(
    JSON.parse(readFileSync(join(dir, 'navmesh.json'), 'utf8')) as NavMeshData,
  );
  return { model, nav: new DistrictNav(mesh, (x, z) => model.floorAt(x, z)) };
}

function scene(
  opts: {
    at?: number;
    ships?: MooredInput[];
    bottles?: number;
    perks?: string[];
    crews?: Record<string, CrewDrunk>;
    /** The watch thinks nothing of you (the default), or judges your conduct. */
    judged?: boolean;
  } = {},
) {
  const { model, nav } = load();
  const clock = { t: opts.at ?? NIGHT };
  const state = createWorldState('moored', clock.t);
  const pockets: Pockets = {
    purse: 1000,
    stores: { 'store.lockpicks': 3, 'store.whiskey': opts.bottles ?? 0 },
  };
  const crews = opts.crews ?? {};
  const world: DistrictWorld = { containers: {}, doors: {}, crews };
  const stowed: Crate[] = [];
  const present = new Set((opts.ships ?? [WREN]).map((s) => s.id));
  const commits: CrimeInput[] = [];
  const notices: string[] = [];
  const defs = gameLaw();
  const lw = () => lawWorld(state, 'moored');
  if (!def) throw new Error('no district');
  const gangway = model.mark('gangway.city_dock');
  const watch = createWatch({
    model,
    nav,
    tier: 0,
    seed: 'moored',
    conditions: () => ({
      gameSeconds: clock.t,
      cloud01: 0,
      fogM: 20_000,
      rain01: 0,
      wantedTier: 0,
      fame01: 0.2,
    }),
    ...(opts.judged ? {} : { suspect: () => false }),
    onCaptured: () => undefined,
    pockets,
    law: {
      commit: (i) => {
        commits.push(i);
        return commitCrime(defs, lw(), i, clock.t);
      },
      addWitness: (id, w) => addWitness(defs, lw(), id, w, clock.t),
      region: () => REGION,
      port: 'port.bayfield',
    },
    moored: { ships: opts.ships ?? [WREN], present: (id) => present.has(id), crews },
    heist: {
      targets: def.targets,
      world,
      hooks: {
        stowPoints: () => [{ x: gangway.x, y: model.floorAt(gangway.x, gangway.z), z: gangway.z }],
        stow: (c) => {
          stowed.push(c);
          return undefined;
        },
        readPapers: () => 'The Hiawatha sails Thursday with flour',
        perk: (id) => (opts.perks ?? []).includes(id),
        notice: (text) => notices.push(text),
      },
    },
  });
  const player = createCharacter({ x: 0, y: 0, z: 0 });
  const s = {
    model,
    watch,
    world,
    crews,
    pockets,
    player,
    clock,
    commits,
    stowed,
    notices,
    present,
    ship: (id = WREN.id) => {
      const m = watch.moored.find((k) => k.id === id);
      if (!m) throw new Error(id);
      return m;
    },
    stand(x: number, z: number) {
      player.position.x = x;
      player.position.z = z;
      player.position.y = model.floorAt(x, z);
    },
    hold(sec: number) {
      let first = true;
      for (let t = 0; t < sec; t += DT) {
        watch.interact(DT, player, true, first);
        first = false;
      }
      watch.interact(DT, player, false, false);
    },
    step(seconds = DT) {
      for (let t = 0; t < seconds; t += DT) watch.step(DT, player);
    },
    prompt: () => watch.toolsHud(player)?.prompt,
    sailor: (id = WREN.id) => watch.stealth.guard(s.ship(id).watch),
  };
  s.step();
  return s;
}

describe('the whiskey trick, in numbers', () => {
  it('names a ship the way the papers do', () => {
    expect(shipWords({ name: 'Supply tug Wren' })).toBe('the supply tug Wren');
    expect(shipWords({ name: 'Emma' })).toBe('the Emma');
    expect(shipWords({ name: 'The Emma' })).toBe('The Emma');
  });

  it('asks a bottle for every four hands, three at most, and half for a saloon keeper', () => {
    expect(bottlesFor(5, rules, false)).toBe(2);
    expect(bottlesFor(4, rules, false)).toBe(1);
    expect(bottlesFor(22, rules, false)).toBe(3);
    expect(bottlesFor(5, rules, true)).toBe(1);
    expect(bottlesFor(0, rules, false)).toBe(1);
  });

  it('finds the crews in the saloon from four till one', () => {
    expect(crewInSaloon(12, rules)).toBe(false);
    expect(crewInSaloon(16, rules)).toBe(true);
    expect(crewInSaloon(23.5, rules)).toBe(true);
    expect(crewInSaloon(0.5, rules)).toBe(true);
    expect(crewInSaloon(2, rules)).toBe(false);
  });
});

describe.skipIf(!baked)('a ship moored at the fish pier', () => {
  it('gets a gangway on the pier beside her, with her hold and cabin either hand', () => {
    const { model, nav } = load();
    const [wren] = placeMoored(model, nav, [WREN]);
    if (!wren) throw new Error('not placed');
    expect(wren.key).toBe('ship.la_pointe_supply_1');
    // On the pier's deck, off her side, not in the water or in her hull.
    expect(wren.gangway.y).toBeGreaterThan(1);
    expect(wren.gangway.x).toBeLessThan(WREN.x - WREN.beamM / 2);
    expect(nav.walkable(wren.gangway)).toBe(true);
    for (const p of [wren.hold, wren.cabin]) {
      expect(p.y).toBeGreaterThan(1);
      expect(Math.hypot(p.x - wren.gangway.x, p.z - wren.gangway.z)).toBeLessThan(3);
    }
    expect(wren.hold.z).not.toBeCloseTo(wren.cabin.z, 1);
    // The watch has his back to his ship.
    expect(Math.sin(wren.gangway.face)).toBeLessThan(-0.9);
  });

  it('lays a ship on the other side of the pier too, and leaves out one with no pier', () => {
    const { model, nav } = load();
    const adrift: MooredInput = { ...WREN, id: 'ship.zz', x: -120, z: -70 };
    const placed = placeMoored(model, nav, [WREN, adrift, LUND]);
    expect(placed.map((s) => s.id)).toEqual([LUND.id, WREN.id]);
    expect(placed[0]?.gangway.x).toBeGreaterThan(LUND.x);
    expect(placed.length).toBeLessThanOrEqual(MAX_MOORED);
  });

  it('makes her hold of what she carries, and her cabin of her crew', () => {
    const { model, nav } = load();
    const [wren] = placeMoored(model, nav, [WREN]);
    if (!wren) throw new Error('not placed');
    const hold = holdTable(wren, rules);
    expect(hold.name).toBe("the supply tug Wren's hold");
    expect(hold.crates).toEqual([
      { good: 'good.flour', min: 6, max: 6 },
      { good: 'good.salt', min: 4, max: 4 },
    ]);
    const cabin = cabinTable(wren, rules);
    expect(cabin.cashCents).toEqual([750, 2250]);
    expect(cabin.documents).toBeGreaterThan(0);
  });

  it("seats her hands round one of the saloon's tables", () => {
    const { model, nav } = load();
    const ships = placeMoored(model, nav, [WREN, LUND]);
    const tables = crewTables(model.marks, ships);
    expect(tables.map((t) => t.mark.id)).toEqual(['crew.0', 'crew.1']);
    const saloon = model.buildings.find((b) => b.def.id === 'saloon');
    for (const t of tables) {
      const figures = crewFigures(t.mark, t.ship);
      expect(figures).toHaveLength(3);
      for (const f of figures) {
        expect(model.buildingAt(f.x, model.floorAt(f.x, f.z) + 0.5, f.z)).toBe(saloon);
        // Short of the partition and the walls.
        expect(f.z).toBeGreaterThan(8.6);
        expect(f.z).toBeLessThan(15.6);
      }
    }
  });

  it('posts a sailor at her gangway and makes her hull solid', () => {
    const s = scene();
    const g = s.sailor();
    expect(g?.type.id).toBe('npc.sailor');
    const m = s.ship();
    expect(
      Math.hypot((g?.body.position.x ?? 0) - m.gangway.x, (g?.body.position.z ?? 0) - m.gangway.z),
    ).toBeLessThan(0.5);
    expect(g?.body.position.y).toBeCloseTo(m.gangway.y, 1);
    const near: unknown[] = [];
    s.model.colliders.query(WREN.x, WREN.z, 1, near as never);
    expect(near).toContain(m.hull);
    expect(m.hull.disabled).toBeFalsy();
  });
});

describe.skipIf(!baked)('robbing her sober', () => {
  it('lifts her cargo a crate at a time, and her mate finds it at dawn', () => {
    const s = scene();
    const m = s.ship();
    s.stand(m.hold.x - 0.5, m.hold.z);
    expect(s.prompt()?.label).toBe('Lift a crate of flour (10 left)');
    s.hold(3);
    expect(s.watch.heist?.carrying).toMatchObject({
      good: 'good.flour',
      owner: 'company.northland_packet',
      building: m.key,
    });
    expect(s.commits).toHaveLength(1);
    expect(s.commits[0]).toMatchObject({
      crime: 'crime.burglary',
      company: 'company.northland_packet',
      details: { victim: 'Supply tug Wren', goods: [{ good: 'good.flour', qty: 1 }] },
    });
    expect(s.commits[0]?.witnesses).toEqual([
      {
        id: 'evidence.ship.la_pointe_supply_1',
        kind: 'sailor',
        name: "the supply tug Wren's mate",
        identification: 'unknown',
        reportAt: nextDawn(NIGHT),
      },
    ]);
    expect(s.world.containers[`${m.key}.hold`]?.taken).toEqual({ 'good.flour': 1 });
  });

  it("keeps her captain's cash behind the cabin lock", () => {
    const s = scene();
    const m = s.ship();
    s.stand(m.cabin.x - 0.5, m.cabin.z);
    expect(s.prompt()?.label).toBe("Pick the supply tug Wren's cabin (tier 1)");
    s.hold(4);
    expect(s.prompt()?.label).toBe("Go through the supply tug Wren's cabin");
    const purse = s.pockets.purse;
    s.hold(3);
    const got = s.pockets.purse - purse;
    expect(got).toBeGreaterThanOrEqual(700);
    expect(got).toBeLessThanOrEqual(2300);
    expect(s.commits.map((c) => c.crime)).toEqual(['crime.burglary']);
    expect(s.commits[0]?.details?.cashCents).toBe(got);
  });

  it('is seen by a deck watch who is awake', () => {
    const s = scene({ judged: true });
    const m = s.ship();
    // In front of him on the pier with her flour in your arms.
    s.stand(m.hold.x - 0.5, m.hold.z);
    s.hold(3);
    expect(s.watch.heist?.carrying).toBeDefined();
    s.stand(m.gangway.x - 2.5, m.gangway.z);
    s.step(8);
    expect(['suspicious', 'alerted', 'search', 'fetch']).toContain(s.sailor()?.state);
  });

  it('has nothing to rob once she has sailed', () => {
    const s = scene();
    const m = s.ship();
    s.present.delete(WREN.id);
    s.step();
    expect(m.hull.disabled).toBe(true);
    expect(s.watch.alongside(m)).toBe(false);
    s.stand(m.hold.x - 0.5, m.hold.z);
    expect(s.prompt()).toBeUndefined();
  });
});

describe.skipIf(!baked)('the whiskey trick (§6.2)', () => {
  it('finds her crew at a table in the evening, not at noon', () => {
    const evening = scene({ at: EVENING });
    expect(evening.watch.crews()).toMatchObject([
      { mark: { id: 'crew.0' }, ship: { id: WREN.id }, bottles: 2, stood: false },
    ]);
    expect(scene({ at: NOON }).watch.crews()).toEqual([]);
  });

  it("wants its bottles, and won't be stood twice", () => {
    const s = scene({ at: EVENING, bottles: 1 });
    expect(s.watch.standCrew(s.ship())).toBe("They'd want 2 bottles: you've 1");
    expect(s.pockets.stores['store.whiskey']).toBe(1);
    expect(s.crews).toEqual({});
    s.pockets.stores['store.whiskey'] = 3;
    expect(s.watch.standCrew(s.ship())).toMatch(/a bottle goes aboard the supply tug Wren/);
    expect(s.pockets.stores['store.whiskey']).toBe(1);
    expect(s.watch.standCrew(s.ship())).toBe("They've had your whiskey already");
    expect(s.pockets.stores['store.whiskey']).toBe(1);
  });

  it('gets the deck watch drunk, then asleep within the hour, and her hold is yours', () => {
    const s = scene({ at: EVENING, bottles: 2, judged: true });
    const m = s.ship();
    s.watch.standCrew(m);
    s.step();
    expect(s.sailor()?.state).toBe('drunk');
    const r = s.crews[m.key];
    expect(r?.night).toBe(nightOf(EVENING));
    const [lo, hi] = rules.whiskey.passOutMin;
    expect((r?.passOutAt ?? 0) - EVENING).toBeGreaterThanOrEqual(lo * 60);
    expect((r?.passOutAt ?? 0) - EVENING).toBeLessThanOrEqual(hi * 60);
    expect(s.watch.crews()[0]?.stood).toBe(true);

    // An hour on: asleep at his post, and the crew gone back aboard.
    s.clock.t = EVENING + 3600;
    s.step();
    expect(s.sailor()?.state).toBe('unconscious');
    expect(s.watch.crews()).toEqual([]);

    // Her flour over the rail under his nose: nobody stirs.
    s.stand(m.hold.x - 0.5, m.hold.z);
    s.hold(3);
    expect(s.watch.heist?.carrying?.good).toBe('good.flour');
    s.stand(m.gangway.x - 2, m.gangway.z);
    s.step(6);
    expect(s.sailor()?.state).toBe('unconscious');
    expect(s.watch.pursued).toBe(false);

    // He sleeps the night through (a blow's two hours would have had him up by now)...
    s.clock.t = EVENING + 6 * 3600;
    s.step();
    expect(s.sailor()?.state).toBe('unconscious');
    // ...and wakes with the dawn.
    s.clock.t = nextDawn(EVENING) + 60;
    s.step();
    expect(s.sailor()?.state).not.toBe('unconscious');
  });

  it('is reported late and vaguely: a friendly fellow with whiskey', () => {
    const s = scene({ at: EVENING, bottles: 2 });
    const m = s.ship();
    s.watch.standCrew(m);
    s.clock.t = EVENING + 3600;
    s.step();
    s.stand(m.hold.x - 0.5, m.hold.z);
    s.hold(3);
    const w = s.commits[0]?.witnesses[0];
    expect(s.commits[0]?.crime).toBe('crime.burglary');
    expect(w?.identification).toBe('unknown');
    expect(w?.name).toMatch(/friendly fellow with whiskey/);
    expect(w?.reportAt).toBe(nextDawn(s.clock.t) + rules.whiskey.trick.lateReportH * 3600);
    // Hours after a sober crew's mate would have told it.
    const sober = crewEvidence(m, s.clock.t, false, rules);
    expect((w?.reportAt ?? 0) - (sober.reportAt ?? 0)).toBe(8 * 3600);
  });

  it('works faster and on fewer bottles for a saloon keeper', () => {
    const s = scene({ at: EVENING, bottles: 1, perks: ['perk.whiskey_trick'] });
    expect(s.watch.crews()[0]?.bottles).toBe(1);
    s.watch.standCrew(s.ship());
    const plain = scene({ at: EVENING, bottles: 2 });
    plain.watch.standCrew(plain.ship());
    const fast = (s.crews[s.ship().key]?.passOutAt ?? 0) - EVENING;
    const slow = (plain.crews[plain.ship().key]?.passOutAt ?? 0) - EVENING;
    expect(fast).toBeCloseTo(slow / 2, 5);
  });

  it("isn't shaken awake by the next ship's watch across the pier", () => {
    const s = scene({ at: EVENING, bottles: 2, ships: [WREN, LUND] });
    s.watch.standCrew(s.ship());
    s.clock.t = EVENING + 3600;
    s.step();
    expect(s.sailor()?.state).toBe('unconscious');
    // The other watch has him in plain sight for a good while.
    const found: string[] = [];
    s.watch.stealth.on((e) => {
      if (e.type === 'BodyFound') found.push(e.npc);
    });
    s.step(20);
    expect(found).toEqual([s.ship().watch]);
    s.clock.t = EVENING + 3 * 3600;
    s.step();
    expect(s.sailor()?.state).toBe('unconscious');
  });

  it('is remembered through a reload ashore, and forgotten the next night', () => {
    const first = scene({ at: EVENING, bottles: 2 });
    first.watch.standCrew(first.ship());
    const crews = structuredClone(first.crews);
    const later = scene({ at: EVENING + 3600, crews });
    later.step();
    expect(later.sailor()?.state).toBe('unconscious');
    const small = scene({ at: EVENING + 7 * 3600, crews });
    small.step();
    expect(small.sailor()?.state).toBe('unconscious');
    const tomorrow = scene({ at: EVENING + 86400, crews });
    tomorrow.step();
    expect(tomorrow.sailor()?.state).toBe('patrol');
    expect(tomorrow.watch.crews()[0]?.stood).toBe(false);
  });
});
