import { describe, expect, it } from 'vitest';
import bayfieldJson from '../data/districts/bayfield.json';
import { Rng } from '../src/core/rng';
import { createGreyboxDistrict } from '../src/debug/stealth-greybox/district';
import {
  conduct,
  layoutConductMap,
  rectConductMap,
  withinHours,
  type ConductInputs,
} from '../src/gameplay/onfoot/conduct';
import { createCharacter, type CharacterState } from '../src/gameplay/onfoot/controller';
import { createFootLaw, crimeForSighting } from '../src/gameplay/onfoot/foot-law';
import { gameNpcs, type GuardSpawn } from '../src/gameplay/onfoot/guards';
import { createStealth, type StealthInputs } from '../src/gameplay/onfoot/stealth';
import {
  behind,
  bribeChance,
  bribePrice,
  createTools,
  gameTools,
  type Pockets,
  type ToolContext,
} from '../src/gameplay/onfoot/tools';
import { lawWorld } from '../src/gameplay/law';
import { gameLaw } from '../src/sim/law/defs';
import { addWitness, commitCrime, fileDue, heatIn, type LawEvent } from '../src/sim/law/law';
import type { SkyLight } from '../src/sim/law/perception';
import { parseLayout } from '../src/sim/district/layout';
import { createWorldState } from '../src/sim/world-state';
import { footToolsHud } from '../src/ui/hud/foot-tools-model';

const DT = 1 / 60;
const DEG = Math.PI / 180;
const NIGHT = 10 * 86400 + 23 * 3600;
const NEW_MOON: SkyLight = {
  sunElevationRad: -40 * DEG,
  moonElevationRad: 45 * DEG,
  moonIllumination01: 0,
  cloud01: 0,
};
const FULL_MOON: SkyLight = { ...NEW_MOON, moonIllumination01: 1 };
const REGION = 'region.apostles';

function walking(over: Partial<ConductInputs> = {}): ConductInputs {
  return {
    at: { x: 0, z: 0 },
    gait: 'walk',
    crouching: false,
    swimming: false,
    hour: 23,
    night: true,
    ...over,
  };
}

describe('conduct (plan 08 §4: when being seen is suspicious)', () => {
  const map = rectConductMap([
    { id: 'yard', kind: 'private', rect: { minX: 0, maxX: 10, minZ: 0, maxZ: 10 } },
    { id: 'shop', kind: 'shop', hours: [7, 18], rect: { minX: 20, maxX: 30, minZ: 0, maxZ: 10 } },
    { id: 'wharf', kind: 'closedAtNight', rect: { minX: 40, maxX: 50, minZ: 0, maxZ: 10 } },
  ]);

  it('walking in the street is nothing, day or night', () => {
    expect(conduct(map, walking({ at: { x: -20, z: 0 } })).suspect).toBe(false);
    expect(conduct(map, walking({ at: { x: -20, z: 0 }, night: false, hour: 12 })).suspect).toBe(
      false,
    );
  });

  it('a private yard is trespass by day too; a shop only outside its hours', () => {
    expect(conduct(map, walking({ at: { x: 5, z: 5 }, night: false, hour: 12 }))).toMatchObject({
      suspect: true,
      reason: 'trespass',
      words: 'Trespassing',
    });
    expect(conduct(map, walking({ at: { x: 25, z: 5 }, night: false, hour: 12 })).suspect).toBe(
      false,
    );
    expect(conduct(map, walking({ at: { x: 25, z: 5 } })).reason).toBe('trespass');
    expect(conduct(map, walking({ at: { x: 45, z: 5 } })).reason).toBe('afterHours');
    expect(conduct(map, walking({ at: { x: 45, z: 5 }, night: false, hour: 9 })).suspect).toBe(
      false,
    );
  });

  it('skulking any time, running and swimming at night', () => {
    expect(conduct(map, walking({ at: { x: -20, z: 0 }, crouching: true })).reason).toBe(
      'skulking',
    );
    expect(conduct(map, walking({ at: { x: -20, z: 0 }, gait: 'run' })).reason).toBe('running');
    expect(
      conduct(map, walking({ at: { x: -20, z: 0 }, gait: 'run', night: false, hour: 12 })).suspect,
    ).toBe(false);
    expect(conduct(map, walking({ at: { x: -20, z: 0 }, swimming: true })).reason).toBe('swimming');
  });

  it('a man over your shoulder or a weapon in hand comes first, even by day', () => {
    const day = { at: { x: -20, z: 0 }, night: false, hour: 12 };
    expect(conduct(map, walking({ ...day, armed: true })).reason).toBe('armed');
    expect(conduct(map, walking({ ...day, armed: true, carryingBody: true })).reason).toBe('body');
    expect(conduct(map, walking({ ...day, carryingLoot: true })).reason).toBe('loot');
  });

  it('opening hours run past midnight', () => {
    expect(withinHours(23, [9, 1])).toBe(true);
    expect(withinHours(0.5, [9, 1])).toBe(true);
    expect(withinHours(2, [9, 1])).toBe(false);
    expect(withinHours(17.9, [7, 18])).toBe(true);
    expect(withinHours(18, [7, 18])).toBe(false);
  });

  it("Bayfield's buildings: warehouses are private, the shops keep their hours", () => {
    const layout = parseLayout(bayfieldJson);
    const map = layoutConductMap(layout, gameTools().file);
    const centre = (id: string) => {
      const b = layout.buildings.find((x) => x.id === id);
      if (!b) throw new Error(id);
      return {
        x: layout.bounds.x0 + (b.col + b.cols / 2) * layout.cellM,
        z: layout.bounds.z0 + (b.row + b.rows / 2) * layout.cellM,
      };
    };
    const at = (id: string, hour: number) =>
      conduct(map, walking({ at: centre(id), hour, night: hour > 20 || hour < 6 }));
    expect(at('hollister_warehouse', 12).reason).toBe('trespass');
    expect(at('lockup', 12).reason).toBe('trespass');
    expect(at('chandlery', 10).suspect).toBe(false);
    expect(at('chandlery', 22).reason).toBe('trespass');
    expect(at('saloon', 23).suspect).toBe(false);
    expect(at('saloon', 3).reason).toBe('trespass');
    // The street outside the saloon is public at night.
    const s = centre('saloon');
    expect(conduct(map, walking({ at: { x: s.x, z: s.z - 40 } })).area).toBeUndefined();
  });

  it('the HUD says it plainly', () => {
    const d = createGreyboxDistrict();
    const stealth = createStealth(
      { zone: d, nav: d.nav, lamps: d.lamps, rng: Rng.fromSeed('t') },
      gameNpcs(),
      [],
    );
    const tools = createTools(
      stealth,
      { purse: 1234, stores: { 'store.cosh': 1 } },
      d,
      Rng.fromSeed('t'),
    );
    const hud = footToolsHud(
      tools,
      conduct(map, walking({ at: { x: 5, z: 5 } })),
      undefined,
      0,
      1234,
    );
    expect(hud.conduct).toBe('Suspicious if seen: Trespassing');
    expect(hud.belt.map((s) => [s.key, s.name, s.count])).toEqual([
      ['1', 'Cosh', '×1'],
      ['2', 'Rope', 'none'],
      ['3', 'Knife', ''],
      ['4', 'Whiskey', 'none'],
      ['5', 'Bribe', '$12'],
    ]);
  });
});

// ---------------------------------------------------------------------------------------
// The tools on guards in the greybox's open street, with the real law behind them.

/** Always yes, or always no: the tools' dice. */
function dice(yes: boolean): Rng {
  return { chance: () => yes, range: (lo: number) => lo, next: () => 0.5 } as unknown as Rng;
}

/** A guard standing at a spot facing north (−z), forever. */
function post(id: string, type: string, x: number, z: number, face = 0): GuardSpawn {
  return { id, type, route: { loop: false, points: [{ x, z, waitS: 1e6, face }] } };
}

function scene(
  spawns: GuardSpawn[],
  at: { x: number; z: number },
  opts: { yes?: boolean; sky?: SkyLight; tier?: number; suspect?: boolean } = {},
) {
  const d = createGreyboxDistrict();
  const stealth = createStealth(
    { zone: d, nav: d.nav, lamps: d.lamps, rng: Rng.fromSeed('foot-tools'), lawPost: d.lawPost },
    gameNpcs(),
    spawns,
    opts.tier ?? 0,
  );
  const state = createWorldState('foot-tools', NIGHT);
  const pockets: Pockets = {
    purse: 10_000,
    stores: { 'store.cosh': 1, 'store.rope': 1, 'store.whiskey': 2 },
  };
  const tools = createTools(stealth, pockets, d, dice(opts.yes ?? true));
  const defs = gameLaw();
  const inputs: StealthInputs = {
    player: createCharacter({ x: at.x, y: 1.5, z: at.z }, 0),
    sky: opts.sky ?? NEW_MOON,
    fogM: 20000,
    rain01: 0,
    gameSeconds: NIGHT,
    suspect: opts.suspect ?? false,
    fame01: 0.25,
    wantedTier: opts.tier ?? 0,
  };
  const world = () => lawWorld(state, 'foot-tools');
  const law = createFootLaw(
    stealth,
    tools,
    {
      commit: (i) => commitCrime(defs, world(), i, inputs.gameSeconds),
      addWitness: (id, w) => addWitness(defs, world(), id, w, inputs.gameSeconds),
    },
    { region: REGION, port: 'port.bayfield' },
    () => (tools.carrying ? 'body' : inputs.suspect ? 'trespass' : undefined),
  );
  const player = inputs.player as CharacterState;
  const ctx = (): ToolContext => ({
    player,
    gameSeconds: inputs.gameSeconds,
    wantedTier: inputs.wantedTier,
    fame01: inputs.fame01,
    light01: stealth.readout().light.level01,
  });
  const s = {
    d,
    stealth,
    tools,
    pockets,
    state,
    law,
    inputs,
    player,
    ctx,
    g: (id: string) => {
      const g = stealth.guard(id);
      if (!g) throw new Error(id);
      return g;
    },
    wait(sec: number) {
      for (let t = 0; t < sec; t += DT) {
        inputs.gameSeconds += DT * 6;
        stealth.step(DT, inputs);
        tools.step(ctx());
      }
    },
    use() {
      return tools.use(ctx());
    },
    crimes: () =>
      law.events.flatMap((e: LawEvent) => (e.type === 'CrimeCommitted' ? [e.crime] : [])),
    heat: () => heatIn(state, REGION),
  };
  s.wait(0.3);
  return s;
}

describe('the cosh and the knife (plan 08 §6: from behind)', () => {
  it('from behind he drops; from the front the prompt says why not', () => {
    const s = scene([post('w', 'npc.watchman', -10, -17)], { x: -10, z: -15.5 });
    expect(behind(s.g('w'), s.player.position)).toBe(true);
    const o = s.tools.offer(s.ctx());
    expect(o).toMatchObject({ verb: 'knockOut', ok: true, label: 'Knock out the night watchman' });
    expect(s.use()).toEqual([{ type: 'KnockedOut', npc: 'w', seenBy: [] }]);
    expect(s.g('w').state).toBe('unconscious');

    const f = scene([post('w', 'npc.watchman', -10, -17)], { x: -10, z: -18.1 });
    expect(f.tools.offer(f.ctx())).toMatchObject({
      ok: false,
      why: expect.stringMatching(/behind/),
    });
    expect(f.use()).toEqual([]);
    expect(f.g('w').state).not.toBe('unconscious');
  });

  it('a drunk can be coshed from any side', () => {
    const s = scene([post('w', 'npc.watchman', -10, -17)], { x: -10, z: -18.1 });
    s.stealth.makeDrunk('w', s.inputs.gameSeconds, 3600);
    expect(s.tools.offer(s.ctx())).toMatchObject({ verb: 'knockOut', ok: true });
  });

  it('a blow someone sees is an assault at once, with him as witness', () => {
    // The constable a few meters off faces the watchman and the player behind him.
    const s = scene(
      [post('w', 'npc.watchman', -10, -17), post('c', 'npc.constable', -10, -10, 0)],
      { x: -10, z: -15.5 },
      { sky: FULL_MOON },
    );
    s.wait(0.5);
    const evs = s.use();
    expect(evs[0]).toMatchObject({ type: 'KnockedOut', npc: 'w', seenBy: ['c'] });
    expect(s.g('c').state).toBe('alerted');
    expect(s.crimes()).toEqual(['crime.assault']);
    // The watchman, coming round, is another witness to the same assault, not a new crime.
    s.inputs.gameSeconds += 3 * 3600;
    s.wait(0.2);
    expect(s.crimes()).toEqual(['crime.assault']);
  });

  it("unseen, he wakes and reports 'someone' (exit criterion 5); knowing your face, you", () => {
    const s = scene([post('w', 'npc.watchman', -10, -17)], { x: -10, z: -15.5 });
    s.use();
    expect(s.crimes()).toEqual([]);
    s.inputs.gameSeconds += 2 * 3600 + 60;
    s.wait(0.2);
    expect(s.crimes()).toEqual(['crime.assault']);
    // "Someone": the region's alert, not its heat.
    s.inputs.gameSeconds += 3600;
    const filed = fileDue(gameLaw(), lawWorld(s.state, 'foot-tools'), s.inputs.gameSeconds);
    expect(filed.find((e) => e.type === 'ReportFiled')).toMatchObject({
      identification: 'unknown',
      heatAdded: 0,
    });
    expect(s.heat()).toBe(0);

    const k = scene([post('w', 'npc.watchman', -10, -17)], { x: -10, z: -15.5 });
    k.g('w').identified = true;
    k.use();
    k.inputs.gameSeconds += 2 * 3600 + 60;
    k.wait(0.2);
    // A watchman's report lands within the hour, by name.
    k.inputs.gameSeconds += 3600;
    const named = fileDue(gameLaw(), lawWorld(k.state, 'foot-tools'), k.inputs.gameSeconds);
    expect(named.find((e) => e.type === 'ReportFiled')).toMatchObject({
      crime: 'crime.assault',
      identification: 'person',
    });
    expect(k.heat()).toBeGreaterThanOrEqual(30);
  });

  it('a body found is a murder; tied to a face the guards learned tonight', () => {
    const s = scene(
      [
        post('w', 'npc.watchman', -10, -17),
        {
          id: 'c',
          type: 'npc.constable',
          route: {
            loop: false,
            points: [
              { x: -42, z: -18, waitS: 4, face: -Math.PI / 2 },
              { x: 10, z: -18 },
            ],
          },
        },
      ],
      { x: -10, z: -15.5 },
    );
    s.tools.select('tool.knife');
    expect(s.use()).toEqual([{ type: 'Killed', npc: 'w', seenBy: [] }]);
    expect(s.crimes()).toEqual([]);
    // Earlier tonight the constable got a good look at the player's face.
    s.stealth.faceToFace('c', 1, 1);
    // Then off into the dark before he comes by the body.
    s.player.position.x = -50;
    s.player.position.z = 30;
    s.wait(40);
    expect(s.law.events.find((e) => e.type === 'CrimeCommitted')).toMatchObject({
      crime: 'crime.killing',
      details: { killed: 1 },
    });
    expect(s.law.events.find((e) => e.type === 'ReportFiled')).toMatchObject({
      identification: 'person',
    });
    expect(s.heat()).toBeGreaterThanOrEqual(150);
  });

  it('a body found with no face to tie it to is a murder by "someone"', () => {
    const s = scene(
      [
        post('w', 'npc.watchman', -10, -17),
        {
          id: 'c',
          type: 'npc.constable',
          route: {
            loop: false,
            points: [
              { x: -42, z: -18, waitS: 4, face: -Math.PI / 2 },
              { x: 10, z: -18 },
            ],
          },
        },
      ],
      { x: -10, z: -15.5 },
    );
    s.tools.select('tool.knife');
    s.use();
    s.player.position.x = -50;
    s.player.position.z = 30;
    s.wait(40);
    expect(s.crimes()).toEqual(['crime.killing']);
    expect(s.law.events.find((e) => e.type === 'ReportFiled')).toMatchObject({
      identification: 'unknown',
    });
    expect(s.heat()).toBe(0);
  });
});

describe('rope and carrying a man', () => {
  it('rope ties a man out cold, and is spent', () => {
    const s = scene([post('w', 'npc.watchman', -10, -17)], { x: -10, z: -15.5 });
    s.use();
    s.tools.select('tool.rope');
    expect(s.tools.offer(s.ctx())).toMatchObject({ verb: 'bind', ok: true, holdS: 3 });
    expect(s.use()).toEqual([{ type: 'Bound', npc: 'w' }]);
    expect(s.g('w').state).toBe('bound');
    expect(s.pockets.stores['store.rope']).toBe(0);
  });

  it('carry him off: unmistakable while you do; into the lake he drowns and is never found', () => {
    // On the wharf's edge, the lake a step south.
    const s = scene([post('w', 'npc.watchman', -20, 18)], { x: -20, z: 19.2 });
    s.stealth.knockOut('w', s.inputs.gameSeconds);
    s.tools.select('tool.whiskey');
    expect(s.tools.offer(s.ctx())).toMatchObject({
      verb: 'lift',
      label: 'Pick up the night watchman',
    });
    expect(s.use()).toEqual([{ type: 'BodyLifted', npc: 'w' }]);
    expect(s.tools.carrying).toBe('w');
    expect(s.tools.armed()).toBe(false);
    // To the edge, facing the lake.
    s.player.position.z = 19.9;
    s.player.heading = Math.PI;
    s.wait(0.1);
    expect(Math.hypot(s.g('w').body.position.x + 20, s.g('w').body.position.z - 19.9)).toBeLessThan(
      0.5,
    );
    const drop = s.use();
    expect(drop).toEqual([{ type: 'BodyDropped', npc: 'w', sunk: true, drowned: true }]);
    expect(s.g('w').state).toBe('dead');
    expect(s.g('w').found).toBe(true);
    expect(s.crimes()).toEqual([]);
  });

  it('a man seen carrying a body is reported for that man', () => {
    expect(crimeForSighting('body', true)).toBe('crime.killing');
    expect(crimeForSighting('body', false)).toBe('crime.assault');
    expect(crimeForSighting('loot', false)).toBe('crime.petty_theft');
    expect(crimeForSighting('skulking', false)).toBe('crime.trespass');
    expect(crimeForSighting(undefined, false)).toBeUndefined();
  });
});

describe('bribes and whiskey (plan 08 §6, §6.2)', () => {
  it('a price by kind of man and Wanted tier; a marshal is not for sale', () => {
    const s = scene([post('w', 'npc.watchman', -10, -17), post('m', 'npc.marshal', 0, -17)], {
      x: -10,
      z: -18.5,
    });
    const t = gameTools();
    expect(bribePrice(t, s.g('w'), 0)).toBe(500);
    expect(bribePrice(t, s.g('w'), 2)).toBe(1000);
    expect(bribeChance(t, s.g('w'), 0)).toBeCloseTo(0.6);
    s.g('w').identified = true;
    expect(bribeChance(t, s.g('w'), 2)).toBeCloseTo(0.3);
    s.tools.select('tool.purse');
    s.player.position.x = 0;
    expect(s.tools.offer(s.ctx())).toMatchObject({ ok: false, why: "He can't be bought" });
  });

  it('paid, he looks away and your purse is lighter; behind him you must step round', () => {
    const s = scene([post('w', 'npc.watchman', -10, -17)], { x: -10, z: -15.5 });
    s.tools.select('tool.purse');
    expect(s.tools.offer(s.ctx())).toMatchObject({ ok: false, why: 'Get in front of him' });
    s.player.position.z = -18.5;
    expect(s.tools.offer(s.ctx())).toMatchObject({
      verb: 'bribe',
      ok: true,
      label: 'Bribe the night watchman ($5.00)',
      priceCents: 500,
    });
    expect(s.use()).toEqual([{ type: 'BribePaid', npc: 'w', cents: 500 }]);
    expect(s.pockets.purse).toBe(9500);
    expect(s.g('w').state).toBe('bribed');
    // Even trespassing under his nose, he doesn't see you.
    s.inputs.suspect = true;
    s.wait(3);
    expect(s.law.events).toEqual([]);
  });

  it('refused by a constable: he is wary, reports it, and is not asked twice', () => {
    const s = scene([post('c', 'npc.constable', -10, -17)], { x: -10, z: -18.5 }, { yes: false });
    s.tools.select('tool.purse');
    expect(s.use()).toEqual([{ type: 'BribeRefused', npc: 'c', reports: true }]);
    expect(s.g('c').state).toBe('suspicious');
    expect(s.crimes()).toEqual(['crime.bribery']);
    expect(s.heat()).toBeGreaterThan(0);
    expect(s.pockets.purse).toBe(10_000);
    expect(s.tools.offer(s.ctx())).toMatchObject({ ok: false, why: 'He said no' });
  });

  it('a sailor takes a drink, sleeps it off and wakes with nothing to report', () => {
    const s = scene([post('s', 'npc.sailor', -10, -17)], { x: -10, z: -18.5 });
    s.tools.select('tool.whiskey');
    expect(s.tools.offer(s.ctx())).toMatchObject({ label: 'Offer the sailor on watch a drink' });
    expect(s.use()).toEqual([{ type: 'WhiskeyTaken', npc: 's' }]);
    expect(s.pockets.stores['store.whiskey']).toBe(1);
    expect(s.g('s').state).toBe('drunk');
    s.inputs.gameSeconds += 25 * 60;
    s.wait(0.2);
    expect(s.g('s').state).toBe('unconscious');
    const woke: unknown[] = [];
    s.stealth.on((e) => e.type === 'GuardWoke' && woke.push(e));
    s.inputs.gameSeconds += 2 * 3600 + 60;
    s.wait(0.2);
    expect(woke).toEqual([{ type: 'GuardWoke', npc: 's', identified: false, drank: true }]);
    expect(s.crimes()).toEqual([]);
  });

  it("a constable who won't drink is wary; the bottle is kept", () => {
    const s = scene([post('c', 'npc.constable', -10, -17)], { x: -10, z: -18.5 }, { yes: false });
    s.tools.select('tool.whiskey');
    expect(s.use()).toEqual([{ type: 'WhiskeyRefused', npc: 'c' }]);
    expect(s.g('c').state).toBe('suspicious');
    expect(s.pockets.stores['store.whiskey']).toBe(2);
    expect(s.crimes()).toEqual([]);
  });
});
