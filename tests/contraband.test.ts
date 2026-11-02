import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ChartProjection, chartToZone } from '../src/core/coords';
import { EventBus } from '../src/core/events';
import { SECONDS_PER_GAME_DAY } from '../src/core/time';
import { createGameWorld } from '../src/gameplay/ecs';
import { attachEconomy } from '../src/gameplay/economy';
import { attachPorts } from '../src/gameplay/port';
import { createSchooner } from '../src/gameplay/schooner';
import { attachSmuggler, SMUGGLER_ENTITY_ID } from '../src/gameplay/smuggler';
import type { GameContext, GameEvents } from '../src/modes/context';
import {
  defaultDetectionRules,
  detectionChance,
  heatNow,
  makeHot,
  offerLot,
  quietSaleCents,
  riskWord,
  type Refusals,
} from '../src/sim/economy/contraband';
import { gameEconomy, portInfo } from '../src/sim/economy/defs';
import type { CargoStack, Hold } from '../src/sim/economy/hold';
import { quote } from '../src/sim/economy/market';
import {
  buyFromSmuggler,
  fenceQuote,
  fenceRate,
  fenceToSmuggler,
  freshSmugglerState,
  gameSmuggler,
  knowsAnchorage,
  nightOf,
  restock,
  smugglerAbout,
  smugglerAnchorage,
} from '../src/sim/economy/smuggler';
import { loadZoneTerrain } from '../src/sim/terrain/load';
import { manifestFrame } from '../src/sim/terrain/zones';
import { BACKGROUNDS, createWorldState, parseWorldState } from '../src/sim/world-state';
import type { PortSnapshot } from '../src/ui/port/model';
import type { SmugglerSnapshot } from '../src/ui/port/smuggler-model';

/** Phase 4 piece H: hot goods, contraband at a merchant's, and the island smuggler. */

const defs = gameEconomy();
const sm = gameSmuggler();
const WEEK = SECONDS_PER_GAME_DAY;
/** 23:00 on the first night: well after dark in May. */
const NIGHT = 23 * 3600;
const NOON = 12 * 3600;

const hot = (good: string, qty: number, region = 'region.chequamegon', since = 0): CargoStack => ({
  good,
  qty,
  hot: { region, heat: 1, traceability: defs.goods.get(good)?.traceability ?? 0, since },
});

describe('hot goods (plan 05 §6.1)', () => {
  it('cools by half every three weeks', () => {
    const meta = { region: 'region.chequamegon', heat: 1, traceability: 0.5, since: 0 };
    expect(heatNow(meta, 0)).toBe(1);
    expect(heatNow(meta, 3 * WEEK)).toBeCloseTo(0.5);
    expect(heatNow(meta, 6 * WEEK)).toBeCloseTo(0.25);
  });

  it('marks clean cargo hot with the dev command, leaving contract cargo alone', () => {
    const hold: Hold = [
      { good: 'good.rope_canvas', qty: 5 },
      { good: 'good.rope_canvas', qty: 2, contract: 'contract.x' },
    ];
    expect(makeHot(defs, hold, 'good.rope_canvas', 3, 'region.apostles', 100)).toBe(3);
    expect(hold).toEqual([
      { good: 'good.rope_canvas', qty: 2 },
      { good: 'good.rope_canvas', qty: 2, contract: 'contract.x' },
      {
        good: 'good.rope_canvas',
        qty: 3,
        hot: { region: 'region.apostles', heat: 1, traceability: 0.3, since: 100 },
      },
    ]);
    expect(makeHot(defs, hold, 'good.rope_canvas', 10, 'region.apostles', 100)).toBe(2);
    expect(makeHot(defs, hold, 'good.flour', 1, 'region.apostles', 100)).toBe(0);
  });
});

describe('detection odds at a merchant (plan 05 §6.1, §6.3)', () => {
  const at = (stack: CargoStack, port = 'port.bayfield', t = 0) =>
    detectionChance(defs, stack, port, t);

  it('is zero for clean goods and contract cargo', () => {
    expect(at({ good: 'good.flour', qty: 5 })).toBe(0);
    expect(at({ good: 'good.flour', qty: 5, contract: 'c' })).toBe(0);
  });

  it('is high for a fresh lot in the region it was taken in, and falls as it cools', () => {
    const fresh = at(hot('good.hardware', 5));
    expect(fresh).toBeGreaterThan(0.5);
    expect(at(hot('good.hardware', 5), 'port.bayfield', 6 * WEEK)).toBeLessThan(fresh * 0.5);
  });

  it('lets loose goods go elsewhere, but marked goods stay recognizable', () => {
    const grainHere = at(hot('good.grain', 5));
    const grainAway = at(hot('good.grain', 5), 'port.duluth');
    const copperHere = at(hot('good.copper', 5));
    const copperAway = at(hot('good.copper', 5), 'port.duluth');
    expect(grainAway).toBeLessThan(grainHere * 0.4);
    expect(copperAway).toBeGreaterThan(copperHere * 0.8);
    expect(copperHere).toBeGreaterThan(grainHere);
  });

  it("is lower at a village's store than a city's, and higher for a bigger lot", () => {
    const r = defaultDetectionRules();
    const whiskey = (qty: number) => ({ good: 'good.untaxed_whiskey', qty });
    expect(at(whiskey(1), 'port.duluth')).toBeCloseTo(r.contraband * r.merchant.huge);
    expect(at(whiskey(1), 'port.la_pointe')).toBeCloseTo(r.contraband * r.merchant.tiny);
    expect(at(whiskey(12))).toBeGreaterThan(at(whiskey(1)));
    expect(at(whiskey(500))).toBeLessThanOrEqual(r.contraband * r.maxLotFactor);
    expect(at(hot('good.copper', 500), 'port.duluth')).toBeLessThanOrEqual(r.maxChance);
  });

  it('puts the chance in a word', () => {
    expect(riskWord(0.05)).toBe('little risk');
    expect(riskWord(0.5)).toBe('risky');
    expect(riskWord(0.9)).toBe('very risky');
  });
});

describe('offering a lot (piece H)', () => {
  const setup = (cargo: Hold) => {
    const state = createWorldState('offer');
    state.player.cargo = cargo;
    state.player.purse = 0;
    return { state, refusals: {} as Refusals };
  };

  it('comes out at about the odds, and the same way for the same lot in the same week', () => {
    let found = 0;
    const n = 400;
    const chance = detectionChance(
      defs,
      { good: 'good.untaxed_whiskey', qty: 6 },
      'port.bayfield',
      0,
    );
    for (let i = 0; i < n; i++) {
      const { state, refusals } = setup([{ good: 'good.untaxed_whiskey', qty: 6 }]);
      const r = offerLot(
        defs,
        state.markets,
        state.player,
        refusals,
        'port.bayfield',
        0,
        0,
        `s${i}`,
      );
      if (!r.ok) throw new Error(r.reason);
      if (r.outcome !== 'sold') found++;
      const again = setup([{ good: 'good.untaxed_whiskey', qty: 6 }]);
      const r2 = offerLot(
        defs,
        again.state.markets,
        again.state.player,
        again.refusals,
        'port.bayfield',
        0,
        3600,
        `s${i}`,
      );
      expect(r2.ok && r2.outcome).toBe(r.outcome);
    }
    expect(found / n).toBeGreaterThan(chance - 0.07);
    expect(found / n).toBeLessThan(chance + 0.07);
  });

  it('sells undetected contraband on the quiet, without touching the market', () => {
    for (let i = 0; i < 50; i++) {
      const { state, refusals } = setup([{ good: 'good.untaxed_whiskey', qty: 4 }]);
      const before = JSON.stringify(state.markets);
      const r = offerLot(
        defs,
        state.markets,
        state.player,
        refusals,
        'port.bayfield',
        0,
        0,
        `q${i}`,
      );
      if (!r.ok || r.outcome !== 'sold') continue;
      expect(r.totalCents).toBe(quietSaleCents(defs, 'port.bayfield', 'good.untaxed_whiskey', 4));
      expect(state.player.purse).toBe(r.totalCents);
      expect(state.player.cargo).toEqual([]);
      expect(JSON.stringify(state.markets)).toBe(before);
      return;
    }
    throw new Error('never sold');
  });

  it("sells an undetected hot lot at the market's price, moving the market", () => {
    for (let i = 0; i < 80; i++) {
      const lot = hot('good.flour', 5, 'region.duluth', -30 * WEEK);
      const { state, refusals } = setup([lot]);
      const q = quote(defs, state.markets, 'port.bayfield', 'good.flour', 5, 'sell', 0);
      const stock = state.markets['port.bayfield']?.['good.flour']?.stock ?? 0;
      const r = offerLot(
        defs,
        state.markets,
        state.player,
        refusals,
        'port.bayfield',
        0,
        0,
        `h${i}`,
      );
      if (!r.ok || r.outcome !== 'sold') continue;
      expect(r.totalCents).toBe(q.totalCents);
      expect(state.markets['port.bayfield']?.['good.flour']?.stock).toBeCloseTo(stock + 5);
      return;
    }
    throw new Error('never sold');
  });

  it('refuses or confiscates when found out (criterion 7), and the port turns you away for the week', () => {
    const outcomes = new Set<string>();
    for (let i = 0; i < 200 && outcomes.size < 2; i++) {
      const { state, refusals } = setup([
        { good: 'good.untaxed_whiskey', qty: 12 },
        { good: 'good.flour', qty: 1 },
      ]);
      const r = offerLot(
        defs,
        state.markets,
        state.player,
        refusals,
        'port.bayfield',
        0,
        NOON,
        `d${i}`,
      );
      if (!r.ok || r.outcome === 'sold') continue;
      outcomes.add(r.outcome);
      expect(r.event).toMatchObject({
        port: 'port.bayfield',
        region: 'region.chequamegon',
        good: 'good.untaxed_whiskey',
        qty: 12,
        kind: 'contraband',
        outcome: r.outcome,
      });
      const whiskey = state.player.cargo.filter((s) => s.good === 'good.untaxed_whiskey');
      expect(whiskey.length).toBe(r.outcome === 'refused' ? 1 : 0);
      expect(state.player.cargo.some((s) => s.good === 'good.flour')).toBe(true);
      expect(refusals['port.bayfield']).toBe(0);
      if (r.outcome === 'refused') {
        const again = offerLot(
          defs,
          state.markets,
          state.player,
          refusals,
          'port.bayfield',
          0,
          NOON + 3600,
          `d${i}`,
        );
        expect(again).toEqual({ ok: false, reason: 'turnedAway' });
        // Next week they'll look again.
        const next = offerLot(
          defs,
          state.markets,
          state.player,
          refusals,
          'port.bayfield',
          0,
          NOON + WEEK,
          `d${i}`,
        );
        expect(next.ok).toBe(true);
      }
    }
    expect([...outcomes].sort()).toEqual(['confiscated', 'refused']);
  });

  it("won't offer clean goods, or hot goods the port doesn't trade", () => {
    const { state, refusals } = setup([{ good: 'good.flour', qty: 1 }, hot('good.iron_ore', 3)]);
    expect(
      offerLot(defs, state.markets, state.player, refusals, 'port.bayfield', 0, 0, 'x'),
    ).toEqual({ ok: false, reason: 'badLot' });
    const traded = defs.markets.get('port.bayfield')?.goods.has('good.iron_ore');
    const r = offerLot(defs, state.markets, state.player, refusals, 'port.bayfield', 1, 0, 'x');
    if (!traded) expect(r).toEqual({ ok: false, reason: 'notTraded' });
  });
});

describe('the island smuggler (plan 05 §6.2)', () => {
  it("lies at Oak Island's lee, in the Apostles, and matches the rumors' anchorage", () => {
    expect(smugglerAnchorage()).toEqual({
      id: 'anchorage.oak_lee',
      name: "Oak Island's lee",
      where: 'in the lee of Oak Island',
    });
    expect(sm.anchorage.zone).toBe('zone.apostles');
    expect(portInfo('port.la_pointe')?.wantedRegion).toBe(sm.anchorage.region);
    for (const b of sm.knownBy) expect(BACKGROUNDS as readonly string[]).toContain(b);
    for (const s of sm.sells) expect(defs.goods.get(s.good)?.smugglerPriceCents).toBeGreaterThan(0);
  });

  it('is about after dark only', () => {
    expect(smugglerAbout(NIGHT)).toBe(true);
    expect(smugglerAbout(NOON)).toBe(false);
    expect(smugglerAbout(NOON + 2 * WEEK)).toBe(false);
    // Through the small hours of the same night.
    expect(smugglerAbout(WEEK + 2 * 3600)).toBe(true);
    expect(nightOf(NIGHT)).toBe(nightOf(WEEK + 2 * 3600));
    expect(nightOf(NIGHT + WEEK)).toBe(nightOf(NIGHT) + 1);
  });

  it('pays 40% for a fresh lot from a stranger and up to 70% for a cooled one from a friend', () => {
    const s = freshSmugglerState(NIGHT);
    expect(fenceRate(s, 1)).toBeCloseTo(0.4);
    expect(fenceRate(s, 0)).toBeCloseTo(0.55);
    s.dealtCents = sm.rate.trustAtCents * 5;
    expect(fenceRate(s, 0)).toBeCloseTo(0.7);
    expect(fenceRate(s, 1)).toBeCloseTo(0.55);
  });

  it("won't take clean goods, contract cargo or her own whiskey back", () => {
    const s = freshSmugglerState(NIGHT);
    const q = (stack: CargoStack) => fenceQuote(defs, s, stack, NIGHT);
    expect(q({ good: 'good.flour', qty: 1 })).toEqual({ ok: false, reason: 'clean' });
    expect(q({ ...hot('good.flour', 1), contract: 'c' })).toEqual({
      ok: false,
      reason: 'contract',
    });
    expect(q({ good: 'good.untaxed_whiskey', qty: 1 })).toEqual({ ok: false, reason: 'hers' });
    expect(q({ good: 'good.venison', qty: 1 })).toMatchObject({ ok: true });
    expect(q(hot('good.copper', 1, 'region.apostles', NIGHT))).toMatchObject({
      ok: true,
      unitCents: 2400,
    });
  });

  it("sells a night's stock, pays out of a week's cash, and makes both up again the next night", () => {
    const s = freshSmugglerState(NIGHT);
    const trader = { purse: 100_000, cargo: [] as Hold };
    const cap = 80;
    const stock = sm.sells[0]?.cu ?? 0;
    expect(buyFromSmuggler(defs, s, trader, cap, 'good.untaxed_whiskey', stock + 1, NIGHT)).toEqual(
      {
        ok: false,
        reason: 'noStock',
      },
    );
    const b = buyFromSmuggler(defs, s, trader, cap, 'good.untaxed_whiskey', stock, NIGHT);
    expect(b.ok).toBe(true);
    expect(trader.purse).toBe(100_000 - stock * 3000);
    expect(s.cashCents).toBe(sm.weeklyCashCents + stock * 3000);
    // Fresh copper at a little over 40% (she knows you a little now). More than her cash
    // covers is refused whole.
    const cash = s.cashCents;
    trader.cargo = [hot('good.copper', 40, 'region.apostles', NIGHT)];
    const quoted = fenceQuote(defs, s, trader.cargo[0] as CargoStack, NIGHT);
    const unit = quoted.ok ? quoted.unitCents : 0;
    expect(unit).toBeGreaterThan(2400);
    expect(unit).toBeLessThan(2700);
    expect(fenceToSmuggler(defs, s, trader, 0, 40, NIGHT)).toEqual({ ok: false, reason: 'noCash' });
    const n = Math.floor(cash / unit);
    const f = fenceToSmuggler(defs, s, trader, 0, n, NIGHT);
    expect(f).toMatchObject({
      ok: true,
      event: { side: 'fence', qty: n, totalCents: n * unit, hot: true },
    });
    expect(s.cashCents).toBe(cash - n * unit);
    // The rest of the copper keeps its heat.
    expect(trader.cargo.find((c) => c.good === 'good.copper')?.hot).toBeDefined();

    restock(s, NIGHT + WEEK);
    expect(s.cashCents).toBe(sm.weeklyCashCents);
    expect(s.stock['good.untaxed_whiskey']).toBe(stock);
    expect(s.dealtCents).toBe(stock * 3000 + n * unit);
  });

  it('is known from a background, a rumor or the dev command', () => {
    expect(knowsAnchorage(undefined, 'deckhand')).toBe(false);
    expect(knowsAnchorage(undefined, 'saloon_keeper')).toBe(true);
    expect(knowsAnchorage(undefined, 'deckhand', true)).toBe(true);
    const contraband = { smuggler: freshSmugglerState(0), refusals: {}, known: true };
    expect(knowsAnchorage(contraband, 'deckhand')).toBe(true);
  });

  it('saves her state, and fills it in for a save from before piece H', () => {
    const state = createWorldState('save');
    expect(state.contraband?.smuggler.cashCents).toBe(sm.weeklyCashCents);
    const old = JSON.parse(JSON.stringify(state)) as Record<string, unknown>;
    delete old['contraband'];
    expect(parseWorldState(old).contraband).toEqual(state.contraband);
    if (state.contraband) state.contraband.refusals['port.bayfield'] = 3;
    const round = parseWorldState(JSON.parse(JSON.stringify(state)));
    expect(round.contraband?.refusals).toEqual({ 'port.bayfield': 3 });
  });
});

describe('the smuggler and the merchants in play (piece H)', () => {
  const projection = new ChartProjection();
  const frame = { origin: { x: -204333, y: -73945 }, compression: 8 };
  const setup = (gameSeconds: number) => {
    const state = createWorldState('in-play');
    state.environment.clock.gameSeconds = gameSeconds;
    const world = createGameWorld();
    const ctx = { state, world, events: new EventBus<GameEvents>() } as unknown as GameContext;
    const { hazards } = createSchooner(0, 0, 0);
    const economy = attachEconomy(ctx, hazards);
    const shown: (SmugglerSnapshot | undefined)[] = [];
    const opens: boolean[] = [];
    const smuggler = attachSmuggler({
      ctx,
      economy,
      show: (s) => shown.push(s),
      onOpen: (o) => opens.push(o),
    });
    smuggler.setZone({ id: 'zone.apostles', frame });
    return { ctx, world, economy, hazards, smuggler, shown, opens };
  };
  const anchorage = chartToZone(projection.geoToChart(sm.anchorage.at), frame);

  it('brings her in after dark and sends her off by day', () => {
    const { ctx, world, smuggler } = setup(NOON);
    const far = { x: anchorage.x + 2000, z: anchorage.z };
    smuggler.step(far);
    expect(smuggler.present).toBe(false);
    ctx.state.environment.clock.gameSeconds = NIGHT;
    smuggler.step(far);
    expect(smuggler.present).toBe(true);
    const e = [...world.entities].find((x) => x.id === SMUGGLER_ENTITY_ID);
    expect(e?.transform?.position.x).toBeCloseTo(anchorage.x);
    expect(e?.npc?.classId).toBe(sm.classId);
    ctx.state.environment.clock.gameSeconds = WEEK + NOON;
    smuggler.step(far);
    expect(smuggler.present).toBe(false);
    smuggler.setZone({ id: 'zone.twin_ports', frame });
    ctx.state.environment.clock.gameSeconds = NIGHT;
    smuggler.step(far);
    expect(smuggler.present).toBe(false);
  });

  it('opens her screen alongside, slowly, and trades', () => {
    const { ctx, smuggler, shown, opens } = setup(NIGHT);
    const dealt: string[] = [];
    ctx.events.on('SmugglerDealt', (e) => dealt.push(`${e.side} ${e.good} ${e.qty}`));
    smuggler.step(anchorage);
    expect(smuggler.comeAlongside({ x: anchorage.x + 300, z: anchorage.z }, 0)).toMatch(
      /alongside/,
    );
    expect(smuggler.comeAlongside({ x: anchorage.x + 40, z: anchorage.z }, 6)).toMatch(/slowly/);
    expect(smuggler.comeAlongside({ x: anchorage.x + 40, z: anchorage.z }, 1)).toBeUndefined();
    expect(opens).toEqual([true]);
    expect(shown.at(-1)?.boatName).toBe(sm.boatName);
    expect(shown.at(-1)?.lots.find((l) => l.good === 'good.rope_canvas')?.refusal).toMatch(/Clean/);
    expect(smuggler.actions.buy('good.untaxed_whiskey', 3)).toMatch(/3 CU/);
    expect(shown.at(-1)?.sells[0]?.stock).toBe((sm.sells[0]?.cu ?? 0) - 3);
    ctx.state.player.cargo.push(hot('good.copper', 2, 'region.apostles', NIGHT));
    const i = ctx.state.player.cargo.length - 1;
    expect(smuggler.actions.fence(i, 2)).toMatch(/counts out \$48/);
    expect(dealt).toEqual(['buy good.untaxed_whiskey 3', 'fence good.copper 2']);
    smuggler.close();
    expect(opens).toEqual([true, false]);
    expect(shown.at(-1)).toBeUndefined();
  });

  it("offers a contraband lot from the port screen's hold, raising the event", () => {
    const { ctx, economy, hazards } = setup(NOON);
    ctx.state.player.cargo = [{ good: 'good.untaxed_whiskey', qty: 12 }];
    const shown: (PortSnapshot | undefined)[] = [];
    const ports = attachPorts({
      ctx,
      economy,
      hazards,
      berthPier: () => undefined,
      showPort: (s) => shown.push(s),
      showJournal: () => undefined,
      onOpen: () => undefined,
      castOff: () => undefined,
    });
    ports.open('port.bayfield');
    const row = shown.at(-1)?.hold[0];
    expect(row?.offer).toMatchObject({ kind: 'contraband', turnedAway: false });
    const events: string[] = [];
    ctx.events.on('HotGoodsDetected', (e) => events.push(e.outcome));
    ctx.events.on('ContrabandSold', () => events.push('sold'));
    const message = ports.actions.offer(row?.index ?? 0);
    expect(message).toBeTruthy();
    expect(events.length).toBe(1);
    if (events[0] !== 'sold') {
      expect(shown.at(-1)?.hold.every((h) => h.offer?.turnedAway ?? true)).toBe(true);
      expect(ports.actions.offer(0)).toMatch(/turned you away|Nobody needs/);
    }
  });
});

describe('her anchorage on the baked Apostles', () => {
  const dir = join(__dirname, '..', 'public', 'world', 'apostles');
  const baked =
    existsSync(join(dir, 'manifest.json')) &&
    readFileSync(join(dir, 'height', '0-0.bin')).byteLength > 200;

  it.skipIf(!baked)(
    'is deep enough for her and our T1, close under the island to the north',
    async () => {
      const zone = await loadZoneTerrain(async (p) => new Uint8Array(readFileSync(join(dir, p))));
      const f = manifestFrame(zone.manifest);
      const a = chartToZone(new ChartProjection().geoToChart(sm.anchorage.at), f);
      // Room to swing and to come alongside: everywhere within 40 m is deep water.
      for (let k = 0; k < 16; k++) {
        const ang = (k / 16) * Math.PI * 2;
        for (const r of [0, 20, 40]) {
          expect(
            zone.terrain.depthAt(a.x + Math.cos(ang) * r, a.z + Math.sin(ang) * r),
          ).toBeGreaterThan(5);
        }
      }
      // Oak Island's shore within 200 m to the north: its lee from the north and northwest.
      let land = false;
      for (let d = 20; d <= 200; d += 10) if (zone.terrain.heightAt(a.x, a.z - d) > 0) land = true;
      expect(land).toBe(true);
    },
  );
});
