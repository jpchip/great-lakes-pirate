import { describe, expect, it } from 'vitest';
import { SECONDS_PER_GAME_DAY, WORLD_TICK_GAME_SECONDS } from '../src/core/time';
import { gameLaw } from '../src/sim/law/defs';
import { gameJail } from '../src/sim/law/jail';
import {
  addGrudge,
  addWitness,
  commitCrime,
  heatIn,
  releasePending,
  tickLaw,
  type LawEvent,
  type LawWorld,
} from '../src/sim/law/law';
import {
  createCutterBrain,
  stepCutter,
  turnHostile,
  type CutterAction,
  type CutterSense,
} from '../src/sim/law/cutter';
import {
  crewIdentification,
  crewReportAt,
  crewWitness,
  sightingIdentification,
  thirdParties,
  SEA_CRIMES,
} from '../src/sim/law/sea-crimes';
import { createLawState } from '../src/sim/law/state';
import type { Witness } from '../src/sim/law/witness';
import { addStory, gameNews, renderStory, type PressWorld } from '../src/sim/news/papers';
import { freshNews } from '../src/sim/news/state';
import { loseShip, settleHull } from '../src/sim/shipyard/abandon';
import { defaultShipState } from '../src/sim/shipyard/shipyard';
import { freshWrecks, recordWreck, wrecksIn, WRECKS_MAX, type WreckInput } from '../src/sim/wrecks';
import { createWorldState, worldStateSchema } from '../src/sim/world-state';

/**
 * Phase 6 piece F: the law and the world answer (plan 07 §7, §14.4 row F, criteria 7–10).
 * The sea crimes, the robbed crew who reports at her next port (or never), the ships in
 * sight, sinking's news spreading, company grudges, the cutter that shoots to sink once
 * fired on, abandoning ship, the wrecks and the headlines.
 */

const defs = gameLaw();
const jail = gameJail();
const news = gameNews();
const HOUR = 3600;
const NOON = 12 * HOUR;
const DAY = SECONDS_PER_GAME_DAY;
const APOSTLES = 'region.apostles';
const COMPANY = 'company.hollister';

function must<T>(x: T | undefined): T {
  if (x === undefined) throw new Error('missing');
  return x;
}

function world(): LawWorld {
  return { law: createLawState('ship.t1_schooner', 'Wren', 0), standing: {}, seed: 'test' };
}

function run(w: LawWorld, from: number, to: number, here?: string): LawEvent[] {
  const events: LawEvent[] = [];
  for (let t = from + WORLD_TICK_GAME_SECONDS; t <= to; t += WORLD_TICK_GAME_SECONDS) {
    events.push(...tickLaw(defs, w, t, WORLD_TICK_GAME_SECONDS / HOUR, here));
  }
  return events;
}

const crew = (ident: Witness['identification'] = 'ship'): Witness =>
  crewWitness('ship.ada_bell', 'Ada Bell', ident);

const passer: Witness = {
  id: 'ship.passer',
  kind: 'crew',
  name: 'the crew of the Passer',
  identification: 'ship',
};

describe('the sea crimes (data)', () => {
  it('has every sea crime, with a grudge for the robbed company and lines in the papers', () => {
    for (const id of SEA_CRIMES) {
      const c = must(defs.crimes.get(id));
      expect(c.grudge, id).toBeGreaterThan(0);
      expect(news.file.stories.crime[id], id).toBeDefined();
    }
    expect(defs.crimes.get('crime.sinking')?.news).toBe(true);
    expect(news.file.stories.crime['crime.attack_law']).toBeDefined();
  });
});

describe("the robbed crew's report (criterion 7)", () => {
  it('holds the crew back until they are let go, then reports at her next port', () => {
    const w = world();
    const [c] = commitCrime(
      defs,
      w,
      { crime: 'crime.piracy', region: APOSTLES, witnesses: [], pending: crew() },
      NOON,
    );
    const id = must(c?.type === 'CrimeCommitted' ? c.crimeId : undefined);
    expect(w.law.reports.inProgress).toEqual([]);
    run(w, NOON, NOON + DAY, APOSTLES);
    expect(heatIn(w.law, APOSTLES)).toBe(0);

    const at = must(crewReportAt(NOON + DAY, 10 * HOUR));
    const events = releasePending(defs, w, id, at, NOON + DAY);
    const sent = events.find((e) => e.type === 'Witnessed');
    expect(sent).toMatchObject({ eta: NOON + DAY + 10 * HOUR, identification: 'ship' });
    run(w, NOON + DAY, NOON + DAY + 9 * HOUR, APOSTLES);
    expect(heatIn(w.law, APOSTLES)).toBe(0);
    run(w, NOON + DAY + 9 * HOUR, NOON + DAY + 11 * HOUR, APOSTLES);
    expect(heatIn(w.law, APOSTLES)).toBeGreaterThan(0);
  });

  it('reports later when set adrift than when let go', () => {
    const at = (inS: number) => {
      const w = world();
      commitCrime(
        defs,
        w,
        { crime: 'crime.piracy', region: APOSTLES, witnesses: [], pending: crew() },
        NOON,
      );
      const id = must(w.law.reports.crimes[0]).id;
      const e = releasePending(defs, w, id, crewReportAt(NOON, inS), NOON);
      return must(e.find((x) => x.type === 'Witnessed') as { eta: number } | undefined).eta;
    };
    expect(at(30 * HOUR)).toBeGreaterThan(at(8 * HOUR));
  });

  it('never reports when they went down with her, and nobody else saw: no Wanted', () => {
    const w = world();
    commitCrime(
      defs,
      w,
      { crime: 'crime.sinking', region: APOSTLES, witnesses: [], pending: crew() },
      NOON,
    );
    const id = must(w.law.reports.crimes[0]).id;
    expect(crewReportAt(NOON, undefined)).toBeUndefined();
    releasePending(defs, w, id, undefined, NOON);
    expect(w.law.reports.crimes).toEqual([]);
    run(w, NOON, NOON + 3 * DAY, APOSTLES);
    expect(heatIn(w.law, APOSTLES)).toBe(0);
  });

  it('a ship in sight reports on her own, and the crew on the same crime counts once', () => {
    const w = world();
    commitCrime(
      defs,
      w,
      { crime: 'crime.piracy', region: APOSTLES, witnesses: [passer], pending: crew() },
      NOON,
    );
    const id = must(w.law.reports.crimes[0]).id;
    releasePending(defs, w, id, NOON + 2 * HOUR, NOON);
    run(w, NOON, NOON + 3 * DAY, APOSTLES);
    const heat = must(defs.crimes.get('crime.piracy')).heat;
    // One crime's heat, not two (identification factor at most 1).
    expect(heatIn(w.law, APOSTLES)).toBeLessThanOrEqual(heat);
    expect(heatIn(w.law, APOSTLES)).toBeGreaterThan(0);
  });

  it('the master who picks you up adds a witness to a crime still open', () => {
    const w = world();
    commitCrime(
      defs,
      w,
      { crime: 'crime.piracy', region: APOSTLES, witnesses: [], pending: crew() },
      NOON,
    );
    const id = must(w.law.reports.crimes[0]).id;
    const events = addWitness(
      defs,
      w,
      id,
      { ...passer, id: 'rescuer', identification: 'person', reportAt: NOON + 6 * HOUR },
      NOON,
    );
    expect(events.find((e) => e.type === 'Witnessed')).toMatchObject({
      identification: 'person',
      eta: NOON + 6 * HOUR,
    });
    expect(addWitness(defs, w, 'crime-999', passer, NOON)).toEqual([]);
  });
});

describe('who can name you', () => {
  it('a boarded crew knows your ship, and your face once you are Known', () => {
    const knows = { boarded: true, watcher: undefined, knowsFromTier: 2 };
    expect(crewIdentification({ ...knows, fameTier: 0 })).toBe('ship');
    expect(crewIdentification({ ...knows, fameTier: 2 })).toBe('person');
    expect(
      crewIdentification({ boarded: false, watcher: undefined, fameTier: 3, knowsFromTier: 2 }),
    ).toBe('unknown');
    expect(
      crewIdentification({ boarded: false, watcher: 'schooner', fameTier: 0, knowsFromTier: 2 }),
    ).toBe('schooner');
  });

  it('a ship in sight reads your profile close by day, less by night', () => {
    expect(sightingIdentification(400, 0, 600)).toBe('ship');
    expect(sightingIdentification(1500, 0, 600)).toBe('schooner');
    expect(sightingIdentification(250, 0.8, 600)).toBe('schooner');
    expect(sightingIdentification(1500, 0.8, 600)).toBe('unknown');
  });

  it('leaves the victims out of the third parties and keeps the best sighting', () => {
    const seen: Witness[] = [
      { ...passer, identification: 'schooner' },
      { ...passer, identification: 'ship' },
      crew('person'),
    ];
    const out = thirdParties(seen, new Set([crew().id]));
    expect(out).toHaveLength(1);
    expect(out[0]?.identification).toBe('ship');
  });
});

describe('sinking spreads, and companies remember', () => {
  it("sinking's news spreads Wanted to the neighboring regions", () => {
    const w = world();
    commitCrime(defs, w, { crime: 'crime.sinking', region: APOSTLES, witnesses: [passer] }, NOON);
    const events = run(w, NOON, NOON + 3 * DAY, APOSTLES);
    const spread = events.find((e) => e.type === 'HeatSpread');
    expect(spread).toMatchObject({
      from: APOSTLES,
      to: must(defs.regionById.get(APOSTLES)).neighbors,
    });
    expect(spread?.type === 'HeatSpread' && spread.heat).toBeGreaterThan(0);
  });

  it('a crime named to you raises the company grudge and lowers Standing', () => {
    const w = world();
    w.standing[COMPANY] = 50;
    commitCrime(
      defs,
      w,
      {
        crime: 'crime.piracy',
        region: APOSTLES,
        witnesses: [{ ...passer, identification: 'person' }],
        company: COMPANY,
      },
      NOON,
    );
    const events = run(w, NOON, NOON + 3 * DAY, APOSTLES);
    expect(events.some((e) => e.type === 'GrudgeChanged')).toBe(true);
    expect(w.grudges?.[COMPANY]).toBeGreaterThan(0);
    expect(w.standing[COMPANY]).toBeLessThan(50);
  });

  it('caps a grudge and lets it fade', () => {
    const w = world();
    const max = defs.actors.companies.grudgeMax;
    addGrudge(defs, w, COMPANY, max * 3);
    expect(w.grudges?.[COMPANY]).toBe(max);
    run(w, 0, 100 * DAY);
    expect(w.grudges?.[COMPANY]).toBeUndefined();
  });
});

describe('the Morrill once fired on (criteria 8 and 10)', () => {
  const sense = (over: Partial<CutterSense> = {}): CutterSense => ({
    tier: 1,
    inspectsFromTier: 1,
    pursuesFromTier: 2,
    awareness: 'spotted',
    identified: true,
    player: { x: 0, z: 0 },
    distanceM: 500,
    playerKn: 7,
    playerShoal: false,
    rigging01: 1,
    ...over,
  });
  const fire = (actions: CutterAction[]) =>
    actions.filter((a): a is Extract<CutterAction, { type: 'fire' }> => a.type === 'fire');

  it('fires at your rigging to disable, never at the hull, until you fire on her', () => {
    const b = createCutterBrain();
    const out: CutterAction[] = [];
    for (let t = 0; t < 180; t += 0.1) out.push(...stepCutter(b, sense({ tier: 3 }), 0.1, () => 0));
    const shots = fire(out);
    expect(shots.length).toBeGreaterThan(0);
    expect(shots.every((s) => s.aim === 'rigging')).toBe(true);
  });

  it('fired on, she opens fire on the hull at once, whatever your tier', () => {
    const b = createCutterBrain();
    turnHostile(b);
    const out: CutterAction[] = [];
    for (let t = 0; t < 10; t += 0.1) out.push(...stepCutter(b, sense({ tier: 0 }), 0.1, () => 0));
    expect(out.some((a) => a.type === 'hail')).toBe(false);
    const shots = fire(out);
    expect(shots.length).toBeGreaterThan(0);
    expect(shots.every((s) => s.aim === 'hull')).toBe(true);
  });
});

describe('abandoning ship (plan 07 §14.6 decision 2)', () => {
  it('pays from the purse, then the strongboxes by word, then work', () => {
    const fee = jail.sendWord.feeCents;
    const s = settleHull(jail, 10000, [{ id: 'h1', cash: 5000 + fee }], 20000);
    expect(s.fromPurse).toBe(10000);
    expect(s.fromBoxes).toEqual([{ hideout: 'h1', cents: 5000 + fee }]);
    expect(s.wordFeeCents).toBe(fee);
    expect(s.owedCents).toBe(5000);
    expect(s.workDays).toBe(Math.ceil(5000 / jail.abandon.workCentsPerDay));

    const rich = settleHull(jail, 50000, [{ id: 'h1', cash: 99999 }], 20000);
    expect(rich).toMatchObject({ fromPurse: 20000, fromBoxes: [], owedCents: 0, workDays: 0 });

    const broke = settleHull(jail, -500, [{ id: 'h1', cash: fee }], 20000);
    expect(broke).toMatchObject({ fromPurse: 0, fromBoxes: [], owedCents: 20000 });
  });

  it('loses her cargo, powder and guns, and leaves a worn hull of the yard', () => {
    const ship = defaultShipState('ship.t2_schooner');
    ship.weapons.push({ weapon: 'weapon.light_cannon', mount: 'port' });
    const player = {
      cargo: [{ good: 'good.flour', qty: 12, basis: 100 }],
      ship,
      ammo: { charges: 30 },
    };
    const lost = loseShip(jail, player as Parameters<typeof loseShip>[1]);
    expect(lost.classId).toBe('ship.t2_schooner');
    expect(lost.cargo).toEqual([{ good: 'good.flour', qty: 12 }]);
    expect(lost.guns).toContain('weapon.light_cannon');
    expect(player.cargo).toEqual([]);
    expect(player.ammo.charges).toBe(0);
    expect(player.ship.classId).toBe(jail.abandon.hullClass);
    expect(player.ship.hull01).toBe(jail.abandon.wornHull01);
    expect(player.ship.weapons.every((w) => w.mount === 'hand')).toBe(true);
  });
});

describe('wrecks', () => {
  const input = (over: Partial<WreckInput> = {}): WreckInput => ({
    shipId: 'ship.ada_bell',
    name: 'Ada Bell',
    classId: 'ship.fish_tug',
    className: 'Fish tug',
    ownerName: 'Hollister Fish & Packing Co.',
    how: 'scuttled',
    byPlayer: true,
    at: { lat: 46.9, lon: -90.7 },
    zone: { id: 'zone.apostles', x: 10, z: 20 },
    regionName: 'the Apostle Islands',
    now: NOON,
    drowned: 0,
    cargo: [{ good: 'good.fish', qty: 8 }],
    ...over,
  });

  it('records where she lies, what she carried, and a line for the ledger', () => {
    const s = freshWrecks();
    const w = recordWreck(s, input());
    expect(w.lore).toContain('The fish tug Ada Bell (Hollister Fish & Packing Co.), scuttled');
    expect(w.lore).toContain('All hands got off.');
    expect(w.lore).toContain('Her hold went down full.');
    expect(wrecksIn(s, 'zone.apostles')).toHaveLength(1);
    expect(wrecksIn(s, 'zone.duluth')).toHaveLength(0);
    const drowned = recordWreck(s, input({ how: 'sunk', drowned: 3 }));
    expect(drowned.lore).toContain('3 hands lost with her.');
  });

  it('keeps the chart to the last few dozen', () => {
    const s = freshWrecks();
    for (let i = 0; i < WRECKS_MAX + 5; i++) recordWreck(s, input({ name: `Hulk ${i}` }));
    expect(s.list).toHaveLength(WRECKS_MAX);
    expect(s.list[0]?.name).toBe('Hulk 5');
  });

  it('keeps wrecks and grudges in the save', () => {
    const state = createWorldState('wrecks');
    state.wrecks = freshWrecks();
    recordWreck(state.wrecks, input());
    state.player.grudges = { [COMPANY]: 30 };
    const back = worldStateSchema.parse(JSON.parse(JSON.stringify(state)));
    expect(back.wrecks?.list).toHaveLength(1);
    expect(back.player.grudges).toEqual({ [COMPANY]: 30 });
  });
});

describe('the headlines', () => {
  it('names the ship sunk, her owners and the dead', () => {
    const n = freshNews(-1);
    const s = must(
      addStory(news, n, {
        kind: 'crime',
        key: 'crime:sinking',
        at: 0,
        region: APOSTLES,
        ident: 'person',
        crime: 'crime.sinking',
        heat: 90,
        victim: 'the fish tug Ada Bell',
        owner: 'Hollister Fish & Packing Co.',
        killed: 2,
      }),
    );
    const world: PressWorld = {
      law: defs,
      lawWorld: { law: createLawState('ship.t1_schooner', 'Lark', 0), standing: {}, seed: 's' },
      captain: 'Ada Reid',
      ship: 'Lark',
      seed: 'seed',
      goodName: (g) => g,
      cutter: () => [],
      weather: (p) => ({ text: `For ${p.town}: fair.`, signals: [] }),
    };
    const paper = must(news.papers[0]);
    const a = renderStory(news, world, s, paper, 0);
    const text = `${a.headline} ${a.deck} ${a.body}`;
    expect(text.toLowerCase()).toContain('ada bell');
    expect(text).not.toMatch(/\{\w+\}/);
  });
});
