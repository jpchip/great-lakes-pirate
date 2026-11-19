import { describe, expect, it } from 'vitest';
import rivalsJson from '../data/rival_templates.json';
import { rivalTemplatesSchema } from '../data/schemas/rivals';
import { EventBus } from '../src/core/events';
import { Rng } from '../src/core/rng';
import { SECONDS_PER_GAME_DAY, WORLD_TICK_GAME_SECONDS } from '../src/core/time';
import { attachEconomy } from '../src/gameplay/economy';
import { attachEvents } from '../src/gameplay/events';
import { attachLaw } from '../src/gameplay/law';
import { attachPapers } from '../src/gameplay/papers';
import {
  attachRivals,
  createRivalContacts,
  huntingLanes,
  rivalContactId,
} from '../src/gameplay/rivals';
import { attachTraffic } from '../src/gameplay/traffic';
import type { GameContext, GameEvents } from '../src/modes/context';
import { westernSuperiorChart } from '../src/sim/chart/chart-data';
import { createContacts } from '../src/sim/chart/traffic';
import { geoDistanceM } from '../src/sim/discovery/discovery';
import { siteGeo, SITES } from '../src/sim/hideouts/stash';
import { fameTier, gameLaw } from '../src/sim/law/defs';
import { commitCrime, fileDue, heatIn } from '../src/sim/law/law';
import { createLawState } from '../src/sim/law/state';
import {
  acceptParley,
  activeRivals,
  agreeToMeet,
  betray,
  betrayalDue,
  blameRival,
  canEmerge,
  clearCamps,
  createRivalsState,
  emergeRival,
  leaveCheck,
  maxRivals,
  noteYourCrime,
  offerParley,
  pinnedOnYou,
  retiring,
  RIVALS,
  sellToLaw,
  similarity,
  stashLead,
  trackFame,
  yourShares,
  type EmergeWorld,
  type Rival,
} from '../src/sim/rivals/rivals';
import { createWorldState, worldStateSchema } from '../src/sim/world-state';

const DAY = SECONDS_PER_GAME_DAY;
const law = gameLaw();
const lanes = huntingLanes(law);
const seq = (...xs: number[]) => {
  let i = 0;
  return () => xs[i++ % xs.length] as number;
};
const world = (now: number, over: Partial<EmergeWorld> = {}): EmergeWorld => ({
  now,
  lanes,
  playerTier: 1,
  keepClear: [],
  hereRegion: 'region.apostles',
  ...over,
});
function must<T>(x: T | undefined): T {
  if (x === undefined) throw new Error('missing');
  return x;
}

describe('rival templates', () => {
  it('validate, with every method and personality', () => {
    expect(() => rivalTemplatesSchema.parse(rivalsJson)).not.toThrow();
    expect(RIVALS.personalities.map((p) => p.id).sort()).toEqual(
      ['brute', 'showman', 'sly', 'smuggler'].sort(),
    );
  });
  it('keep every camp clear of every hideout site, now and to come', () => {
    const sites = SITES.flatMap((s) => {
      const g = siteGeo(s);
      return g ? [g] : [];
    });
    expect(sites.length).toBeGreaterThan(0);
    expect(clearCamps(sites).map((c) => c.id)).toEqual(RIVALS.camps.map((c) => c.id));
    for (const c of RIVALS.camps) {
      for (const g of [...sites, ...RIVALS.avoid.map((a) => a.at)]) {
        expect(geoDistanceM(c.at, g)).toBeGreaterThanOrEqual(RIVALS.rules.keepClearM);
      }
    }
  });
  it('have prize lanes through the regions you rob in', () => {
    expect(lanes.length).toBeGreaterThan(5);
    for (const r of ['region.apostles', 'region.duluth', 'region.chequamegon']) {
      expect(lanes.some((l) => l.regions.includes(r))).toBe(true);
    }
  });
});

describe('emergence', () => {
  it('waits for Fame 2, then brings one; up to three at tiers 3–4', () => {
    const s = createRivalsState(0);
    trackFame(s, 1, 0);
    expect(canEmerge(s, 1, 10 * DAY)).toBe(false);
    trackFame(s, 2, DAY);
    expect(canEmerge(s, 2, DAY + 0.5 * DAY)).toBe(false);
    expect(canEmerge(s, 2, 2 * DAY)).toBe(true);
    emergeRival(s, world(2 * DAY), Math.random);
    expect(canEmerge(s, 2, 30 * DAY)).toBe(false);
    expect(maxRivals(3)).toBe(2);
    expect(maxRivals(4)).toBe(3);
    expect(canEmerge(s, 3, 2 * DAY + 2 * DAY)).toBe(false);
    expect(canEmerge(s, 3, 2 * DAY + RIVALS.rules.againDays * DAY)).toBe(true);
  });

  it('copies your methods and comes to the region you rob in', () => {
    const s = createRivalsState(0);
    for (let i = 0; i < 6; i++) noteYourCrime(s, 'crime.piracy', 'region.duluth', i * 100);
    noteYourCrime(s, 'crime.sinking', 'region.duluth', 700);
    const r = must(emergeRival(s, world(DAY), Rng.fromSeed('a').next.bind(Rng.fromSeed('a'))));
    expect(r.region).toBe('region.duluth');
    expect(lanes.find((l) => l.id === r.lane)?.regions).toContain('region.duluth');
    expect(r.methods.boarding ?? 0).toBeGreaterThan(0.4);
    expect(similarity(r.methods, s.record.methods)).toBeGreaterThan(0.5);
    expect(RIVALS.camps.some((c) => c.id === r.camp)).toBe(true);
    expect(r.classId).toBe('ship.rival_schooner');
  });

  it('never gives two at sea the same slot, name or camp', () => {
    const s = createRivalsState(0);
    noteYourCrime(s, 'crime.piracy', 'region.apostles', 0);
    const rand = Math.random;
    const a = must(emergeRival(s, world(DAY), rand));
    const b = must(emergeRival(s, world(DAY), rand));
    const c = must(emergeRival(s, world(DAY), rand));
    expect(new Set([a.slot, b.slot, c.slot]).size).toBe(3);
    expect(new Set([a.camp, b.camp, c.camp]).size).toBe(3);
    expect(new Set([a.nick, b.nick, c.nick]).size).toBe(3);
    expect(emergeRival(s, world(DAY), rand)).toBeUndefined();
  });

  it('matches its ship to yours, a tier at most below', () => {
    const s = createRivalsState(0);
    const big = must(emergeRival(s, world(0, { playerTier: 2 }), seq(0.5, 0.9)));
    expect(['ship.rival_schooner', 'ship.rival_schooner_t2']).toContain(big.classId);
  });
});

describe('blame by method', () => {
  function rivalWith(
    methods: Rival['methods'],
    region = 'region.apostles',
  ): {
    s: ReturnType<typeof createRivalsState>;
    r: Rival;
  } {
    const s = createRivalsState(0);
    const r = must(emergeRival(s, world(0), Math.random));
    r.methods = methods;
    r.region = region;
    return { s, r };
  }

  it("puts a rival's raid on you by how much of your work is like it", () => {
    const { s, r } = rivalWith({ boarding: 1 });
    expect(pinnedOnYou(s, r, 'boarding', () => 0.01)).toBe(false);
    for (let i = 0; i < 5; i++) noteYourCrime(s, 'crime.piracy', 'region.apostles', 0);
    expect(yourShares(s).boarding).toBe(1);
    expect(pinnedOnYou(s, r, 'boarding', () => RIVALS.rules.blame.onYou - 0.01)).toBe(true);
    expect(pinnedOnYou(s, r, 'boarding', () => RIVALS.rules.blame.onYou + 0.01)).toBe(false);
    expect(pinnedOnYou(s, r, 'smuggling', () => 0.01)).toBe(false);
  });

  it('puts your crime on a rival in its region who works that way', () => {
    const { s, r } = rivalWith({ boarding: 0.5, burglary: 0.5 });
    expect(blameRival(s, 'crime.piracy', 'region.apostles', () => 0.2)?.id).toBe(r.id);
    expect(blameRival(s, 'crime.piracy', 'region.apostles', () => 0.4)).toBeUndefined();
    expect(blameRival(s, 'crime.piracy', 'region.duluth', () => 0)).toBeUndefined();
    expect(blameRival(s, 'crime.contraband', 'region.apostles', () => 0)).toBeUndefined();
  });

  it('through the pipeline: their raid named "a schooner" is your heat, never your name', () => {
    const st = createLawState('ship.t1_schooner', 'Kestrel', 0);
    const w = { law: st, standing: {}, seed: 's' };
    commitCrime(
      law,
      w,
      {
        crime: 'crime.piracy',
        region: 'region.apostles',
        by: 'rival.1',
        witnesses: [{ id: 'crew.x', kind: 'crew', name: 'crew', identification: 'person' }],
      },
      0,
    );
    const ev = fileDue(law, w, 10 * DAY);
    const filed = ev.find((e) => e.type === 'ReportFiled');
    expect(filed?.type === 'ReportFiled' && filed.identification).toBe('schooner');
    expect(filed?.type === 'ReportFiled' && filed.by).toBe('rival.1');
    expect(heatIn(st, 'region.apostles')).toBeCloseTo(50 * 0.5);
    expect(st.fame.value).toBe(0);
  });

  it('through the pipeline: yours put down to a rival raises the alert, not your heat', () => {
    const st = createLawState('ship.t1_schooner', 'Kestrel', 0);
    const w = { law: st, standing: {}, seed: 's' };
    const witness = (identification: 'schooner' | 'person') => ({
      id: `crew.${identification}`,
      kind: 'crew' as const,
      name: 'crew',
      identification,
    });
    commitCrime(
      law,
      w,
      {
        crime: 'crime.piracy',
        region: 'region.apostles',
        blamedOn: 'rival.1',
        witnesses: [witness('schooner')],
      },
      0,
    );
    fileDue(law, w, 10 * DAY);
    expect(heatIn(st, 'region.apostles')).toBe(0);
    expect(st.wanted['region.apostles']?.alert ?? 0).toBeGreaterThan(0);
    // Somebody who saw your face isn't fooled.
    commitCrime(
      law,
      w,
      {
        crime: 'crime.piracy',
        region: 'region.apostles',
        blamedOn: 'rival.1',
        witnesses: [witness('person')],
      },
      20 * DAY,
    );
    fileDue(law, w, 30 * DAY);
    expect(heatIn(st, 'region.apostles')).toBeGreaterThan(0);
  });
});

describe('the ways they leave', () => {
  const one = () => {
    const s = createRivalsState(0);
    return { s, r: must(emergeRival(s, world(0), Math.random)) };
  };
  it('the law takes the notorious', () => {
    const { r } = one();
    r.heat = 5000;
    expect(leaveCheck(r, { now: 0, hours: 24, gale: false }, () => 0.2)).toBe('caught');
    r.heat = 0;
    expect(leaveCheck(r, { now: 0, hours: 1, gale: false }, () => 0.2)).toBeUndefined();
  });
  it('a gale takes some', () => {
    const { r } = one();
    expect(leaveCheck(r, { now: 0, hours: 1, gale: true }, seq(0.99, 0.001))).toBe('lost');
    expect(leaveCheck(r, { now: 0, hours: 1, gale: false }, seq(0.99, 0.001))).toBeUndefined();
  });
  it('they retire once your Fame has fallen a while', () => {
    const { s, r } = one();
    trackFame(s, 1, 0);
    expect(retiring(s, DAY)).toBeUndefined();
    expect(retiring(s, RIVALS.rules.retireAfterDays * DAY)?.id).toBe(r.id);
  });
  it('beaten, they leave a lead to their stash at the camp', () => {
    const { r } = one();
    const lead = must(stashLead(r));
    const camp = must(RIVALS.camps.find((c) => c.id === r.camp));
    expect(lead.center).toEqual(camp.at);
    expect(lead.id).toMatch(/^stash\.rival_\d+$/);
  });
});

describe('parley', () => {
  it('split: they take a lane elsewhere, and a betrayer comes back', () => {
    const s = createRivalsState(0);
    noteYourCrime(s, 'crime.piracy', 'region.apostles', 0);
    const r = must(emergeRival(s, world(0), Math.random));
    r.personality = 'showman';
    offerParley(r, DAY);
    expect(r.parley?.kind).toBe('split');
    expect(r.parley?.port).toBe(RIVALS.rules.parley.ports[r.region]);
    agreeToMeet(r, DAY);
    const home = r.lane;
    acceptParley(r, lanes, 'region.apostles', DAY, seq(0.01, 0.3));
    expect(r.parley?.stage).toBe('split');
    expect(r.lane).not.toBe(home);
    expect(lanes.find((l) => l.id === r.lane)?.regions).not.toContain('region.apostles');
    expect(betrayalDue(r, DAY + DAY)).toBe(false);
    expect(betrayalDue(r, DAY + RIVALS.rules.parley.betrayAfterDays * DAY)).toBe(true);
    betray(r, 4 * DAY);
    expect(r.lane).toBe(home);
    expect(r.parley?.stage).toBe('betrayed');
  });
  it('truce: no blame either way; selling them out heats them', () => {
    const s = createRivalsState(0);
    for (let i = 0; i < 3; i++) noteYourCrime(s, 'crime.piracy', 'region.apostles', 0);
    const r = must(emergeRival(s, world(0), Math.random));
    r.personality = 'smuggler';
    r.methods = { boarding: 1 };
    r.region = 'region.apostles';
    offerParley(r, 0);
    agreeToMeet(r, 0);
    acceptParley(r, lanes, 'region.apostles', 0, () => 0.99);
    expect(r.parley?.stage).toBe('truce');
    expect(pinnedOnYou(s, r, 'boarding', () => 0)).toBe(false);
    expect(blameRival(s, 'crime.piracy', 'region.apostles', () => 0)).toBeUndefined();
    const q = must(emergeRival(s, world(0), Math.random));
    offerParley(q, 0);
    agreeToMeet(q, 0);
    sellToLaw(q, 0);
    expect(q.heat).toBe(RIVALS.rules.parley.sellHeat);
  });
});

describe('rivals in the game', () => {
  function setup(seed = 'rivals') {
    const state = createWorldState(seed, 0);
    // Late June: the lanes are busy.
    state.environment.clock.gameSeconds = 7 * DAY;
    const events = new EventBus<GameEvents>();
    const ctx = { state, events, rng: Rng.fromSeed(seed) } as unknown as GameContext;
    const economy = attachEconomy(ctx, undefined);
    const lawG = attachLaw(ctx, 'seed');
    const papers = attachPapers({ ctx, law: lawG, seed, goodName: (g) => g });
    const game = attachEvents({
      ctx,
      law: lawG.defs,
      economy: economy.defs,
      papers,
      gale: () => false,
      onVoyage: () => false,
      showScene: () => undefined,
      onSceneOpen: () => undefined,
    });
    const projection = westernSuperiorChart().projection;
    const traffic = attachTraffic(ctx, [
      ...createContacts(projection, `${seed}-traffic`, state.environment.clock.gameSeconds),
      ...createRivalContacts(),
    ]);
    const leads: string[] = [];
    const rivals = attachRivals({
      ctx,
      law: lawG,
      events: game,
      traffic,
      projection,
      seed: `${seed}-traffic`,
      gale: () => false,
      lead: (l) => leads.push(l.id),
    });
    const seen: string[] = [];
    events.tap((type) => seen.push(type));
    const hours = (n: number): void => {
      const steps = Math.round((n * 3600) / WORLD_TICK_GAME_SECONDS);
      for (let i = 0; i < steps; i++) {
        state.environment.clock.gameSeconds += WORLD_TICK_GAME_SECONDS;
        events.emit('WorldTick', { gameSeconds: state.environment.clock.gameSeconds });
      }
    };
    return { state, events, ctx, lawG, game, traffic, rivals, leads, seen, hours };
  }

  it('none at Fame 1; one at Fame 2, on the water, in the papers and the saloons', () => {
    const g = setup();
    g.state.fame.value = 60;
    g.hours(48);
    expect(activeRivals(g.state.rivals).length).toBe(0);
    g.state.fame.value = 200;
    expect(fameTier(g.lawG.defs, g.state.fame.value)).toBe(2);
    g.hours(24 * 2 + 2);
    const [r] = activeRivals(g.state.rivals);
    expect(r).toBeDefined();
    const c = must(g.traffic.contacts.find((x) => x.id === rivalContactId(must(r).slot)));
    expect(c.lostUntil).toBeUndefined();
    expect(c.name).toBe(must(r).shipName);
    expect(c.schedule?.laneId).toBe(`lane.rival_${must(r).slot}`);
    expect(g.seen).toContain('RivalEmerged');
    expect(g.state.events?.active.some((a) => a.id === 'event.rival_emerges')).toBe(true);
    const talk = g.game.talk().flatMap((t) => t.lines);
    expect(talk.some((l) => l.includes(must(r).nick))).toBe(true);
  });

  it("robs a ship on its lane through the law's pipeline, and isn't your crime", () => {
    const g = setup();
    const r = must(g.rivals.emerge());
    const crimes = g.state.stats?.crimes ?? 0;
    let robbed: string | undefined;
    for (let i = 0; i < 40 && !robbed?.startsWith('ship.'); i++) {
      robbed = g.rivals.raid(r.id, 'boarding');
      g.hours(3);
    }
    expect(robbed).toMatch(/^ship\./);
    expect(g.state.traffic?.ships[must(robbed)]?.robbed).toBeDefined();
    expect(g.state.stats?.crimes ?? 0).toBe(crimes);
    expect(g.seen).toContain('RivalRaided');
    expect(r.raids).toBeGreaterThan(0);
  });

  it('puts your crime down to a rival who works the same way', () => {
    const g = setup();
    const r = must(g.rivals.emerge());
    r.methods = { boarding: 1 };
    let blamed = 0;
    for (let i = 0; i < 20; i++) {
      const ev = g.lawG.commit({
        crime: 'crime.piracy',
        region: r.region,
        witnesses: [{ id: `c${i}`, kind: 'crew', name: 'crew', identification: 'schooner' }],
      });
      const c = ev.find((e) => e.type === 'CrimeCommitted');
      if (c?.type === 'CrimeCommitted' && c.blamedOn === r.id) blamed++;
    }
    expect(blamed).toBeGreaterThan(4);
    expect(blamed).toBeLessThan(20);
  });

  it('a parley by letter, met in the saloon', () => {
    const g = setup();
    const r = must(g.rivals.emerge());
    expect(g.rivals.parley(r.id)).toBe(true);
    const letter = must(g.game.letters().find((l) => l.from.includes(r.nick)));
    expect(letter.body).toContain(r.nick);
    g.game.answer(letter.key, 'meet');
    expect(r.parley?.stage).toBe('meeting');
    const port = must(r.parley?.port);
    g.game.docked(port);
    const scene = must(g.game.scene());
    expect(scene.title).toContain(r.last);
    expect(g.game.choose('accept')).toBeUndefined();
    expect(['truce', 'split']).toContain(r.parley?.stage);
  });

  it('beaten at sea: Fame, the papers and a lead to the stash; the ship off the water', () => {
    const g = setup();
    const r = must(g.rivals.emerge());
    const fame = g.state.fame.value;
    g.events.emit('ShipSurrendered', {
      shipId: rivalContactId(r.slot),
      classId: r.classId,
      how: 'struck',
    });
    expect(r.status).toBe('defeated');
    expect(g.state.fame.value).toBeGreaterThanOrEqual(fame + RIVALS.rules.defeatFame);
    expect(g.leads).toEqual([must(stashLead(r)).id]);
    expect(g.seen).toContain('RivalDefeated');
    g.traffic.syncLost();
    expect(g.traffic.contacts.find((c) => c.id === rivalContactId(r.slot))?.lostUntil).toBe(1e15);
  });

  it('a season of crime keeps to the caps and round-trips the save', () => {
    const g = setup('season');
    g.state.fame.value = 400; // Infamous: two at most.
    for (let d = 0; d < 40; d++) {
      g.lawG.commit({ crime: 'crime.piracy', region: 'region.apostles', witnesses: [] });
      g.state.fame.value = Math.max(g.state.fame.value, 400);
      g.hours(24);
      expect(activeRivals(g.state.rivals).length).toBeLessThanOrEqual(2);
    }
    expect(g.state.rivals?.list.length).toBeGreaterThan(0);
    const parsed = worldStateSchema.parse(JSON.parse(JSON.stringify(g.state)));
    expect(parsed.rivals).toEqual(g.state.rivals);
  });
});
