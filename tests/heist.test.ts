import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import bayfieldJson from '../data/districts/bayfield.json';
import districtsJson from '../data/districts.json';
import { districtsFileSchema } from '../data/schemas/districts';
import { buildDistrict, type DistrictModel } from '../src/gameplay/district/district';
import { DistrictNav } from '../src/gameplay/district/district-nav';
import { decodeGround } from '../src/gameplay/district/ground';
import { createCharacter, DEFAULT_CONTROLLER } from '../src/gameplay/onfoot/controller';
import { createFootLaw, evidenceWitness, nextDawn } from '../src/gameplay/onfoot/foot-law';
import {
  gameHeist,
  nightOf,
  rollContents,
  type Crate,
  type HeistEvent,
} from '../src/gameplay/onfoot/heist';
import type { Stealth, StealthEvent } from '../src/gameplay/onfoot/stealth';
import type { Pockets } from '../src/gameplay/onfoot/tools';
import { createWatch, type Watch } from '../src/gameplay/onfoot/watch';
import { lawWorld } from '../src/gameplay/law';
import { NavMesh, type NavMeshData } from '../src/sim/district/navmesh';
import { parseLayout } from '../src/sim/district/layout';
import { gameLaw } from '../src/sim/law/defs';
import { addWitness, commitCrime, fileDue, type CrimeInput } from '../src/sim/law/law';
import { createWorldState, type DistrictWorld } from '../src/sim/world-state';
import type { Witness } from '../src/sim/law/witness';

/**
 * Locks, loot and carrying in Bayfield (plan 08 §6.1, §7, §8, §15; Phase 7 piece E part two,
 * exit criterion 6). On the real district with its baked ground, like district-watch.test.ts.
 */

const dir = join(import.meta.dirname, '..', 'public', 'districts', 'bayfield');
const groundPath = join(dir, 'ground.bin');
const baked = existsSync(groundPath) && readFileSync(groundPath).byteLength > 200;

const DT = 1 / 60;
/** 11 p.m. and noon on a June day. */
const NIGHT = 160 * 86400 + 23 * 3600;
const NOON = 160 * 86400 + 12 * 3600;
const REGION = 'region.apostles';
const def = districtsFileSchema.parse(districtsJson)[0];

let loaded: { model: DistrictModel; nav: DistrictNav } | undefined;
function load(): { model: DistrictModel; nav: DistrictNav } {
  if (loaded) return loaded;
  const model = buildDistrict(
    parseLayout(structuredClone(bayfieldJson)),
    decodeGround(new Uint8Array(readFileSync(groundPath))),
  );
  const mesh = new NavMesh(
    JSON.parse(readFileSync(join(dir, 'navmesh.json'), 'utf8')) as NavMeshData,
  );
  loaded = { model, nav: new DistrictNav(mesh, (x, z) => model.floorAt(x, z)) };
  return loaded;
}

function scene(opts: { at?: number; pockets?: Partial<Pockets>; perks?: string[] } = {}) {
  const { model, nav } = load();
  const clock = { t: opts.at ?? NIGHT };
  const state = createWorldState('heist', clock.t);
  const pockets: Pockets = {
    purse: 1000,
    stores: { 'store.lockpicks': 3, 'store.crowbar': 1, ...(opts.pockets?.stores ?? {}) },
    ...(opts.pockets?.purse !== undefined ? { purse: opts.pockets.purse } : {}),
  };
  const world: DistrictWorld = { containers: {}, doors: {} };
  const stowed: Crate[] = [];
  const stock: Record<string, number> = {};
  const papers: string[] = [];
  const gangway = model.mark('gangway.fish_pier');
  const defs = gameLaw();
  const lw = () => lawWorld(state, 'heist');
  const commits: CrimeInput[] = [];
  if (!def) throw new Error('no district');
  const watch: Watch = createWatch({
    model,
    nav,
    tier: 0,
    seed: 'heist',
    conditions: () => ({
      gameSeconds: clock.t,
      cloud01: 0,
      fogM: 20_000,
      rain01: 0,
      wantedTier: 0,
      fame01: 0.2,
    }),
    // The guards think nothing of you here: these tests are about the locks.
    suspect: () => false,
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
    heist: {
      targets: def.targets,
      world,
      hooks: {
        stowPoints: () => [{ x: gangway.x, y: model.floorAt(gangway.x, gangway.z), z: gangway.z }],
        stow: (c) => {
          stowed.push(c);
          return undefined;
        },
        takeStock: (good, qty) => (stock[good] = (stock[good] ?? 0) - qty),
        readPapers: () => {
          papers.push('read');
          return 'The Hiawatha sails Thursday with flour';
        },
        perk: (id) => (opts.perks ?? []).includes(id),
      },
    },
  });
  const heist = watch.heist;
  if (!heist) throw new Error('no heist');
  const player = createCharacter({ x: 0, y: 0, z: 0 });
  const events: HeistEvent[] = [];
  heist.on((e) => events.push(e));
  const s = {
    model,
    watch,
    heist,
    world,
    pockets,
    player,
    clock,
    state,
    stowed,
    stock,
    papers,
    events,
    commits,
    /** Stands you at (x, z) on the floor there, facing a heading. */
    stand(x: number, z: number, heading = 0) {
      player.position.x = x;
      player.position.z = z;
      player.position.y = model.floorAt(x, z);
      player.heading = heading;
    },
    /** Outside a door, `off` m out from the building's middle. */
    atDoor(id: string, off = 0.9) {
      const d = heist.doors.find((k) => k.id === id);
      if (!d) throw new Error(id);
      const b = model.buildings.find((k) => k.def.id === d.building);
      if (!b) throw new Error(d.building);
      const cx = (b.minX + b.maxX) / 2;
      const cz = (b.minZ + b.maxZ) / 2;
      const x = d.alongX ? d.x : d.x + Math.sign(d.x - cx) * off;
      const z = d.alongX ? d.z + Math.sign(d.z - cz) * off : d.z;
      s.stand(x, z);
      return d;
    },
    atMark(mark: string) {
      const c = heist.containers.find((k) => k.mark === mark);
      if (!c) throw new Error(mark);
      s.stand(c.x + 0.6, c.z);
      return c;
    },
    /** Holds F for `sec` seconds (pressing it on the first tick). */
    hold(sec: number) {
      let first = true;
      for (let t = 0; t < sec; t += DT) {
        watch.interact(DT, player, true, first);
        first = false;
      }
      watch.interact(DT, player, false, false);
    },
    press() {
      watch.interact(DT, player, true, true);
      watch.interact(DT, player, false, false);
    },
    step() {
      watch.step(DT, player);
    },
    prompt: () => watch.toolsHud(player)?.prompt,
  };
  s.step();
  return s;
}

describe('locks, loot and evidence (pure)', () => {
  it('rolls a stocking the same every time, fuller in the fall', () => {
    const t = gameHeist().tables.get('loot.fish_warehouse');
    if (!t) throw new Error('table');
    const a = rollContents(t, 'seed:loot.0', 3, 1);
    expect(rollContents(t, 'seed:loot.0', 3, 1)).toEqual(a);
    const fish = (m: number) => {
      let n = 0;
      for (let c = 0; c < 40; c++) n += rollContents(t, 's', c, m).crates['good.salted_fish'] ?? 0;
      return n;
    };
    expect(fish(1.5)).toBeGreaterThan(fish(1));
  });

  it('a night runs noon to noon; the evidence is found at dawn', () => {
    expect(nightOf(NIGHT)).toBe(nightOf(NIGHT + 5 * 3600));
    expect(nightOf(NIGHT)).not.toBe(nightOf(NIGHT + 14 * 3600));
    expect(nextDawn(NIGHT)).toBe(161 * 86400 + 6 * 3600);
    expect(nextDawn(161 * 86400 + 2 * 3600)).toBe(161 * 86400 + 6 * 3600);
    expect(evidenceWitness('w', 'the foreman', NIGHT)).toMatchObject({
      identification: 'unknown',
      reportAt: 161 * 86400 + 6 * 3600,
    });
  });

  it("Bayfield's targets name real buildings and loot marks", () => {
    const layout = parseLayout(structuredClone(bayfieldJson));
    for (const t of def?.targets ?? []) {
      expect(
        layout.buildings.some((b) => b.id === t.building),
        t.building,
      ).toBe(true);
      for (const c of t.containers) {
        expect(
          layout.marks.some((m) => m.id === c.mark && m.kind === 'loot'),
          c.mark,
        ).toBe(true);
        expect(gameHeist().tables.has(c.table), c.table).toBe(true);
      }
    }
  });
});

describe.skipIf(!baked)('locks, loot and carrying in Bayfield', () => {
  it("the warehouse's doors are locked at night, a leaf you can't walk through; open by day", () => {
    const s = scene();
    const door = s.heist.doors.find((d) => d.building === 'hollister_warehouse');
    if (!door) throw new Error('door');
    expect(s.heist.locked(door.id, NIGHT)).toBe(true);
    expect(door.leaf.disabled).toBe(false);
    expect(s.heist.locked(door.id, NOON)).toBe(false);
    s.clock.t = NOON;
    s.step();
    expect(door.leaf.disabled).toBe(true);
  });

  it('hold to pick: letting go keeps the work done; the door stays open tonight only', () => {
    const s = scene({ pockets: { stores: { 'store.lockpicks': 6, 'store.crowbar': 0 } } });
    const door = s.atDoor('hollister_warehouse.door0');
    expect(s.prompt()?.label).toBe('Pick the lock (tier 1)');
    s.hold(1);
    expect(s.heist.locked(door.id, NIGHT)).toBe(true);
    expect(s.prompt()?.hold01).toBeGreaterThan(0.4);
    s.hold(1.2);
    expect(s.heist.locked(door.id, NIGHT)).toBe(false);
    expect(s.events.some((e) => e.type === 'LockPicked')).toBe(true);
    expect(s.world.doors[door.id]).toMatchObject({ how: 'picked' });
    // Picked leaves nothing to find.
    expect(s.commits).toHaveLength(0);
    // The next night it's locked again.
    expect(s.heist.locked(door.id, NIGHT + 86400)).toBe(true);
  });

  it('no picks: the prompt says to try the crowbar; with it in hand, forced loud and reported at dawn', () => {
    const s = scene({ pockets: { stores: { 'store.lockpicks': 0 } } });
    const door = s.atDoor('hollister_warehouse.door0');
    expect(s.prompt()).toMatchObject({ ok: false, why: 'No lockpicks: try the crowbar' });
    s.watch.tools?.select('tool.crowbar');
    expect(s.prompt()?.label).toBe('Force the lock with the crowbar');
    const noises: number[] = [];
    s.watch.on((e: StealthEvent) => {
      if (e.type === 'NoiseMade' && e.noise.kind === 'lock') noises.push(e.noise.radiusM);
    });
    s.hold(1.3);
    expect(s.heist.locked(door.id, NIGHT)).toBe(false);
    expect(noises[0]).toBe(14);
    expect(s.commits).toHaveLength(1);
    expect(s.commits[0]).toMatchObject({
      crime: 'crime.burglary',
      company: 'company.hollister_fish',
    });
    expect(s.commits[0]?.witnesses[0]).toMatchObject({
      id: 'evidence.hollister_warehouse',
      identification: 'unknown',
      reportAt: nextDawn(NIGHT),
    });
    // At dawn the owner finds it: the report is filed, by "someone".
    const filed = fileDue(gameLaw(), lawWorld(s.state, 'heist'), nextDawn(NIGHT) + 60);
    expect(filed.some((e) => e.type === 'ReportFiled' && e.identification === 'unknown')).toBe(
      true,
    );
  });

  it('crates one at a time: out of the stock, slow in your arms, stowed hot with the marks', () => {
    const s = scene();
    s.world.doors['hollister_warehouse.door0'] = { how: 'picked', night: nightOf(NIGHT) };
    const box = s.atMark('loot.0');
    const before = s.heist.contents(box.mark, NIGHT);
    const crates = Object.values(before?.crates ?? {}).reduce((a, b) => a + b, 0);
    expect(crates).toBeGreaterThan(0);
    expect(s.prompt()?.label).toMatch(/^Lift a crate of /);
    s.hold(0.8);
    expect(s.heist.carrying).toMatchObject({ owner: 'company.hollister_fish' });
    const good = s.heist.carrying?.good ?? '';
    expect(s.stock[good]).toBe(-1);
    const after = s.heist.contents(box.mark, NIGHT);
    expect(Object.values(after?.crates ?? {}).reduce((a, b) => a + b, 0)).toBe(crates - 1);
    // Slow, and carrying loot is what a guard would see.
    expect(s.watch.params(DEFAULT_CONTROLLER).walkSpeed).toBeLessThan(DEFAULT_CONTROLLER.walkSpeed);
    s.step();
    expect(s.watch.conduct?.reason).toBe('loot');
    expect(s.watch.toolsHud(s.player)?.load).toMatch(/^Carrying a crate of /);
    // The tools are out of reach with your arms full.
    expect(s.watch.tools?.armed()).toBe(false);
    // Down to the gangway and aboard.
    const g = s.model.mark('gangway.fish_pier');
    s.stand(g.x, g.z);
    expect(s.prompt()?.label).toMatch(/aboard$/);
    s.press();
    expect(s.heist.carrying).toBeUndefined();
    expect(s.stowed).toEqual([expect.objectContaining({ good, owner: 'company.hollister_fish' })]);
    // The theft is the warehouse's burglary, found at dawn.
    expect(s.commits.map((c) => c.crime)).toEqual(['crime.burglary']);
    expect(s.commits[0]?.details?.goods).toEqual([{ good, qty: 1 }]);
  });

  it('a crate put down can be picked up again; into the lake, it is gone', () => {
    const s = scene();
    s.world.doors['hollister_warehouse.door0'] = { how: 'picked', night: nightOf(NIGHT) };
    s.atMark('loot.0');
    s.hold(0.8);
    s.stand(-26, -10);
    expect(s.prompt()?.label).toBe('Put the crate down');
    s.press();
    expect(s.heist.dropped).toHaveLength(1);
    expect(s.prompt()?.label).toMatch(/^Pick up the /);
    s.hold(0.8);
    expect(s.heist.carrying).toBeDefined();
  });

  it("an emptied container stays empty when you come back, until it's stocked again", () => {
    const s = scene();
    const box = s.atMark('loot.0');
    const full = s.heist.contents(box.mark, NIGHT);
    s.hold(0.8);
    const t2 = NIGHT + 3600;
    const later = scene({ at: t2 });
    later.world.containers = s.world.containers;
    const restock = s.world.containers[box.mark]?.restockAt ?? 0;
    expect(restock).toBeGreaterThan(NIGHT);
    const left = later.heist.contents(box.mark, t2);
    const n = (c: typeof left) => Object.values(c?.crates ?? {}).reduce((a, b) => a + b, 0);
    expect(n(left)).toBe(n(full) - 1);
    expect(n(later.heist.contents(box.mark, restock + 1))).toBeGreaterThan(0);
  });

  it("the harbor master's strongbox: a tier-3 lock, then cash and a shipping schedule", () => {
    const s = scene({ pockets: { stores: { 'store.lockpicks': 6, 'store.crowbar': 0 } } });
    s.world.doors['harbor_office.door0'] = { how: 'picked', night: nightOf(NIGHT) };
    const box = s.atMark('loot.harbor_office');
    expect(s.prompt()?.label).toBe("Pick the harbor master's strongbox (tier 3)");
    s.hold(7.2);
    expect(s.heist.contents(box.mark, NIGHT)?.locked).toBe(false);
    const purse = s.pockets.purse;
    expect(s.prompt()?.label).toBe("Go through the harbor master's strongbox");
    s.hold(1.7);
    expect(s.pockets.purse).toBeGreaterThan(purse);
    expect(s.papers).toEqual(['read']);
    expect(s.heist.contents(box.mark, NIGHT)).toMatchObject({ cashCents: 0, documents: false });
    expect(s.commits[0]?.details?.cashCents).toBe(s.pockets.purse - purse);
  });

  it("the Poacher's boot pick never runs out and is quicker", () => {
    const s = scene({
      perks: ['perk.boot_lockpick'],
      pockets: { stores: { 'store.lockpicks': 0 } },
    });
    s.watch.tools?.select('tool.purse');
    const door = s.atDoor('hollister_warehouse.door0');
    expect(s.prompt()?.ok).toBe(true);
    s.hold(1.7);
    expect(s.heist.locked(door.id, NIGHT)).toBe(false);
  });

  it('from inside, the bolt slips without a pick', () => {
    const s = scene({ pockets: { stores: { 'store.lockpicks': 0, 'store.crowbar': 0 } } });
    const door = s.heist.doors.find((d) => d.id === 'hollister_warehouse.door0');
    if (!door) throw new Error('door');
    const b = s.model.buildings.find((k) => k.def.id === 'hollister_warehouse');
    if (!b) throw new Error('b');
    const cx = (b.minX + b.maxX) / 2;
    const cz = (b.minZ + b.maxZ) / 2;
    if (door.alongX) s.stand(door.x, door.z - Math.sign(door.z - cz) * 0.7);
    else s.stand(door.x - Math.sign(door.x - cx) * 0.7, door.z);
    expect(s.prompt()?.label).toBe('Slip the bolt');
    s.press();
    expect(s.heist.locked(door.id, NIGHT)).toBe(false);
  });
});

describe('a guard who sees you with the crates (foot-law)', () => {
  it('is a witness to that burglary, and names you', () => {
    const listeners: ((e: StealthEvent) => void)[] = [];
    const guard = {
      id: 'watchman.hollister_warehouse',
      name: 'Night watchman',
      identified: false,
      type: { witness: 'watchman', onAlert: 'run' },
    };
    const stealth = {
      on: (fn: (e: StealthEvent) => void) => (listeners.push(fn), () => undefined),
      guard: (id: string) => (id === guard.id ? guard : undefined),
    } as unknown as Stealth;
    const heistListeners: ((e: HeistEvent) => void)[] = [];
    const carrying: Crate = {
      good: 'good.salted_fish',
      owner: 'company.hollister_fish',
      building: 'hollister_warehouse',
      since: NIGHT,
    };
    const heist = {
      carrying,
      containers: [{ building: 'hollister_warehouse', owner: 'company.hollister_fish' }],
      on: (fn: (e: HeistEvent) => void) => (heistListeners.push(fn), () => undefined),
    } as unknown as Parameters<typeof createFootLaw>[5] extends infer H
      ? H extends { heist: infer X }
        ? X
        : never
      : never;
    const commits: CrimeInput[] = [];
    const witnesses: Witness[] = [];
    createFootLaw(
      stealth,
      undefined,
      {
        commit: (i) => {
          commits.push(i);
          return [{ type: 'CrimeCommitted', crimeId: 'c1', crime: i.crime } as never];
        },
        addWitness: (_id, w) => (witnesses.push(w), []),
      },
      { region: REGION, port: 'port.bayfield' },
      () => 'loot',
      { heist, now: () => NIGHT, buildingName: () => 'Hollister warehouse' },
    );
    for (const fn of heistListeners) {
      fn({
        type: 'ItemStolen',
        building: 'hollister_warehouse',
        owner: 'company.hollister_fish',
        good: 'good.salted_fish',
      });
    }
    for (const fn of listeners) fn({ type: 'PlayerSpotted', npc: guard.id, identified: false });
    for (const fn of listeners) {
      fn({ type: 'GuardReported', npc: guard.id, identified: false, why: 'seen' });
    }
    expect(commits.map((c) => c.crime)).toEqual(['crime.burglary']);
    expect(witnesses).toEqual([expect.objectContaining({ id: guard.id, kind: 'watchman' })]);
  });
});
