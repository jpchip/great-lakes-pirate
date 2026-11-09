import { describe, expect, it } from 'vitest';
import { EventBus } from '../src/core/events';
import { Rng } from '../src/core/rng';
import { PLAYER_ID } from '../src/gameplay/combat';
import type { Detection } from '../src/gameplay/detection';
import { createGameWorld, type Entity } from '../src/gameplay/ecs';
import { attachLaw } from '../src/gameplay/law';
import type { LawAtSea } from '../src/gameplay/law-at-sea';
import { attachSeaLaw } from '../src/gameplay/sea-law';
import type { GameContext, GameEvents } from '../src/modes/context';
import { gameBoarding } from '../src/sim/boarding/check';
import { createPrize, takeLot } from '../src/sim/boarding/loot';
import { offerLot, type MerchantMemory } from '../src/sim/economy/contraband';
import { gameEconomy } from '../src/sim/economy/defs';
import { fenceAt, freshFenceState, sellToFence } from '../src/sim/economy/fence';
import type { Hold } from '../src/sim/economy/hold';
import { heatIn } from '../src/sim/law/law';
import type { Witness } from '../src/sim/law/witness';
import { createWorldState } from '../src/sim/world-state';

/**
 * Phase 6 piece H, the playtest (plan 07 §14.3, §14.14): the criteria that had no check of
 * their own end to end. Criterion 4, every death in the combat log and its heat when
 * witnessed, for each of the four aftermath choices through the sea law; criterion 6, a
 * looted lot from her hold to a fence, and the honest merchant who finds it out.
 */

const HOUR = 3600;
const NOON = 12 * HOUR;
const APOSTLES = 'region.apostles';
const COMPANY = 'company.hollister_fish';
const ADA = 'ship.ada_bell';

const passer: Witness = {
  id: 'ship.passer',
  kind: 'crew',
  name: 'the crew of the Passer',
  identification: 'ship',
};

/** The sea law over a bare world: one package steamer, and a passer in sight or not. */
function seaLaw(witnessed: boolean) {
  const state = createWorldState('piracy-playtest', NOON);
  const events = new EventBus<GameEvents>();
  const world = createGameWorld();
  const ctx = {
    state,
    events,
    world,
    rng: Rng.fromSeed('piracy-playtest'),
  } as unknown as GameContext;
  const law = attachLaw(ctx, 'seed');
  law.locate = () => APOSTLES;
  const ada: Entity = {
    id: ADA,
    npc: { classId: 'ship.package_steamer' },
    transform: { position: { x: 0, y: 0, z: 0 }, heading: 0 },
  } as unknown as Entity;
  const detection = {
    witnesses: () => (witnessed ? [passer] : []),
    watchers: [],
    hear: () => 0,
  } as unknown as Detection;
  const sea = attachSeaLaw({
    ctx,
    law,
    detection,
    lawAtSea: { firedOn: () => false } as unknown as LawAtSea,
    ships: () => [ada],
    isLawShip: () => false,
    nameOf: () => 'Ada Bell',
    ownerOf: () => COMPANY,
    zoneId: () => undefined,
    geoAt: () => ({ lat: 46.95, lon: -90.75 }),
    dark01: () => 0,
    windKn: () => 10,
    notice: () => undefined,
  });
  return { state, events, law, sea };
}

type Choice = GameEvents['AftermathChosen']['choice'];

/** A boarding fight that kills two and wounds one, her hold looted, then the choice. */
function takeHer(choice: Choice, witnessed: boolean) {
  const t = seaLaw(witnessed);
  const { events } = t;
  const casualties = (killed: number, cause: GameEvents['CrewCasualties']['cause']) =>
    events.emit('CrewCasualties', {
      shipId: ADA,
      by: PLAYER_ID,
      killed,
      wounded: cause === 'boarding' ? 1 : 0,
      cause,
      lethal: true,
    });
  casualties(2, 'boarding');
  events.emit('ShipSurrendered', { shipId: ADA, classId: 'ship.package_steamer', how: 'fought' });
  events.emit('ShipLooted', {
    shipId: ADA,
    owner: COMPANY,
    region: APOSTLES,
    goods: [{ good: 'good.furs', qty: 4 }],
    cashCents: 4_000,
    valueCents: 40_000,
    minutes: 30,
    quick: false,
  });
  const reportInS = {
    letGo: 6 * HOUR,
    disable: 18 * HOUR,
    adrift: 24 * HOUR,
    sinkWithCrew: undefined,
  }[choice];
  if (choice === 'adrift') events.emit('ShipScuttled', { shipId: ADA, withCrew: false });
  if (choice === 'sinkWithCrew') {
    casualties(13, 'sunk');
    events.emit('ShipScuttled', { shipId: ADA, withCrew: true });
  }
  events.emit('AftermathChosen', {
    shipId: ADA,
    owner: COMPANY,
    choice,
    killed: choice === 'sinkWithCrew' ? 13 : 0,
    survivors: choice === 'sinkWithCrew' ? 0 : 13,
    reportInS,
  });
  if (choice === 'adrift' || choice === 'sinkWithCrew') {
    events.emit('ShipSunk', {
      shipId: ADA,
      classId: 'ship.package_steamer',
      by: PLAYER_ID,
      crewAboard: choice === 'sinkWithCrew' ? 13 : 0,
      at: { x: 0, z: 0 },
    });
  }
  const crimes = t.state.reports.crimes.map((c) => c.crime);
  const reports = t.state.reports.inProgress.length;
  t.law.fileAll();
  return {
    log: (t.state.logbook ?? []).map((l) => l.text),
    crimes,
    reports,
    heat: heatIn(t.state, APOSTLES),
    wrecks: t.state.wrecks?.list ?? [],
  };
}

describe('every death in the combat log, and its heat (§14.3 criterion 4)', () => {
  for (const choice of ['letGo', 'disable', 'adrift'] as const) {
    it(`${choice}: the dead logged, killing and piracy committed, her crew's report brings heat`, () => {
      const r = takeHer(choice, false);
      expect(r.log).toContain(
        "2 of the Ada Bell's crew killed in the fight for her deck, 1 wounded.",
      );
      expect(r.log.some((l) => l.startsWith('Took the Ada Bell: 4 CU of'))).toBe(true);
      expect(r.crimes).toEqual(expect.arrayContaining(['crime.killing', 'crime.piracy']));
      expect(r.reports).toBeGreaterThan(0);
      expect(r.heat).toBeGreaterThan(0);
    });
  }

  it('sinkWithCrew: every hand logged dead, and nobody left to tell: no report, no heat', () => {
    const r = takeHer('sinkWithCrew', false);
    expect(r.log).toContain(
      "2 of the Ada Bell's crew killed in the fight for her deck, 1 wounded.",
    );
    expect(r.log).toContain("13 of the Ada Bell's crew killed battened below as she sank.");
    expect(r.log).toContain('Sank the Ada Bell with her crew battened below.');
    // Nobody saw and nobody lived: the crimes are dropped unreported.
    expect(r.crimes).toEqual([]);
    expect(r.reports).toBe(0);
    expect(r.heat).toBe(0);
    expect(r.wrecks.at(-1)).toMatchObject({ how: 'scuttled', drowned: 13 });
  });

  it('sinkWithCrew in sight of another ship: she tells, and the heat comes', () => {
    const r = takeHer('sinkWithCrew', true);
    expect(r.reports).toBeGreaterThan(0);
    expect(r.heat).toBeGreaterThan(0);
  });
});

describe('from her hold to a fence (§14.3 criterion 6)', () => {
  const economy = gameEconomy();
  const rules = gameBoarding();
  const NIGHT = 23 * HOUR;
  const loot = (): Hold => {
    const prize = createPrize(rules, economy, {
      shipId: ADA,
      owner: COMPANY,
      region: 'region.chequamegon',
      now: NIGHT - 2 * HOUR,
      cargo: [{ good: 'good.furs', qty: 6 }],
      cashCents: 0,
    });
    const you = { cargo: [] as Hold, purse: 0 };
    expect(takeLot(rules, economy, prize, you, 20, 'good.furs', 6)).toMatchObject({ ok: true });
    return you.cargo;
  };

  it('comes aboard hot with the owner company marks', () => {
    expect(loot()[0]?.hot).toMatchObject({ owner: COMPANY, region: 'region.chequamegon' });
  });

  it('sells to the Bayfield fence that night, no questions asked', () => {
    const fence = fenceAt('port.bayfield');
    if (!fence) throw new Error('no Bayfield fence');
    const trader = { cargo: loot(), purse: 0 };
    const r = sellToFence(
      economy,
      fence,
      freshFenceState(fence, NIGHT),
      trader as never,
      0,
      6,
      NIGHT,
      0,
    );
    expect(r.ok).toBe(true);
    expect(trader.purse).toBeGreaterThan(0);
    expect(trader.cargo.reduce((n, s) => n + s.qty, 0)).toBe(0);
  });

  it('an honest Bayfield merchant finds out some lots, refusing or taking them, as in Phase 5', () => {
    const outcomes = new Set<string>();
    for (let i = 0; i < 60; i++) {
      const state = createWorldState(`loot-offer-${i}`, NIGHT);
      state.player.cargo = loot();
      const memory: MerchantMemory = { refusals: {}, receivers: [] };
      const r = offerLot(
        economy,
        state.markets,
        state.player,
        memory,
        'port.bayfield',
        0,
        NIGHT,
        `s${i}`,
      );
      expect(r.ok).toBe(true);
      if (r.ok) outcomes.add(r.outcome);
      if (r.ok && r.outcome !== 'sold') expect(r.event.good).toBe('good.furs');
    }
    expect(outcomes.has('sold')).toBe(true);
    expect([...outcomes].some((o) => o === 'refused' || o === 'confiscated')).toBe(true);
  });
});
