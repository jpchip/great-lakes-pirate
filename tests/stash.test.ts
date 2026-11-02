import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { EventBus } from '../src/core/events';
import { SECONDS_PER_GAME_DAY, WORLD_TICK_GAME_SECONDS } from '../src/core/time';
import { attachEconomy } from '../src/gameplay/economy';
import { createSchooner } from '../src/gameplay/schooner';
import { attachStash } from '../src/gameplay/stash';
import type { GameContext, GameEvents } from '../src/modes/context';
import {
  SITES,
  siteAnchorage,
  siteAnchoredAt,
  siteDef,
  stashCash,
  stashedCash,
  stashGoods,
  startingHideouts,
  syncHideouts,
  takeCash,
  takeGoods,
  type HideoutState,
} from '../src/sim/hideouts/stash';
import {
  lieAtAnchor,
  lieRefusal,
  secondsUntil,
  SIGHT_M,
  windShifted,
  type LieCheck,
} from '../src/sim/hideouts/lie-at-anchor';
import { sunAt } from '../src/sim/weather/celestial';
import { layoutHarbors, pierSite } from '../src/sim/harbors';
import { loadZoneTerrain, type LoadedZone } from '../src/sim/terrain/load';
import { manifestFrame } from '../src/sim/terrain/zones';
import { BACKGROUNDS, createWorldState, parseWorldState } from '../src/sim/world-state';
import type { StashSnapshot } from '../src/ui/stash/model';

const fresh = (): HideoutState => ({
  siteId: 'site.stockton',
  claimedAt: 0,
  storage: { goods: [], cash: 0 },
});
const HOT = { region: 'region.apostles', heat: 0.8, traceability: 0.6, since: 100 };

describe('the Stockton stash (piece E)', () => {
  it('is every background’s starting hideout, claimed and empty', () => {
    expect(SITES.map((s) => s.id)).toEqual(['site.stockton']);
    for (const b of BACKGROUNDS) {
      expect(startingHideouts(b, 50)).toEqual({
        'hideout.stockton': { ...fresh(), claimedAt: 50 },
      });
    }
    const run = createWorldState('stash');
    expect(run.hideouts?.['hideout.stockton']?.storage).toEqual({ goods: [], cash: 0 });
    expect(pierSite('pier.stockton_landing')).toBe('site.stockton');
    expect(pierSite('pier.bayfield_city')).toBeUndefined();
  });

  it('gives a save from before piece E its stash on load, and keeps what a stash holds', () => {
    const run = createWorldState('stash-load');
    const raw = JSON.parse(JSON.stringify(run)) as Record<string, unknown>;
    delete raw['hideouts'];
    expect(parseWorldState(raw).hideouts?.['hideout.stockton']).toBeDefined();

    const h = run.hideouts?.['hideout.stockton'];
    if (!h) throw new Error('no stash');
    h.storage.goods.push({ good: 'good.furs', qty: 4, hot: HOT });
    h.storage.cash = 12_345;
    const back = parseWorldState(JSON.parse(JSON.stringify(run)));
    expect(back.hideouts?.['hideout.stockton']?.storage).toEqual({
      goods: [{ good: 'good.furs', qty: 4, hot: HOT }],
      cash: 12_345,
    });
    // Nothing stored shows in the hold.
    expect(back.player.cargo.some((s) => s.good === 'good.furs')).toBe(false);
    expect(syncHideouts(back.hideouts, 'deckhand', 0)).toBe(back.hideouts);
  });

  it('moves goods both ways, keeping hot and contract lots apart', () => {
    const hold = [
      { good: 'good.lumber', qty: 6 },
      { good: 'good.furs', qty: 3, hot: HOT },
      { good: 'good.flour', qty: 2, contract: 'contract.x' },
    ];
    const h = fresh();
    expect(stashGoods(hold, h, 0, 4)).toEqual({ ok: true, good: 'good.lumber', qty: 4 });
    expect(stashGoods(hold, h, 0, 9)).toEqual({ ok: true, good: 'good.lumber', qty: 2 });
    expect(h.storage.goods).toEqual([{ good: 'good.lumber', qty: 6 }]);
    expect(stashGoods(hold, h, 0, 3)).toMatchObject({ ok: true, good: 'good.furs', qty: 3 });
    expect(stashGoods(hold, h, 0, 2)).toMatchObject({ ok: true, good: 'good.flour' });
    expect(hold).toEqual([]);
    expect(h.storage.goods).toEqual([
      { good: 'good.lumber', qty: 6 },
      { good: 'good.furs', qty: 3, hot: HOT },
      { good: 'good.flour', qty: 2, contract: 'contract.x' },
    ]);
    // Taking back fills the hold only as far as it has room.
    expect(takeGoods(hold, 4, h, 0, 6)).toEqual({ ok: true, good: 'good.lumber', qty: 4 });
    expect(takeGoods(hold, 4, h, 0, 1)).toEqual({ ok: false, reason: 'noRoomHold' });
    expect(takeGoods(hold, 20, h, 1, 3)).toMatchObject({ ok: true, good: 'good.furs' });
    expect(hold.at(-1)).toEqual({ good: 'good.furs', qty: 3, hot: HOT });
    expect(stashGoods(hold, h, 9, 1)).toEqual({ ok: false, reason: 'noStack' });
    expect(stashGoods(hold, h, 0, 0)).toEqual({ ok: false, reason: 'badQty' });
  });

  it('holds 40 CU in the shed', () => {
    const h = fresh();
    expect(siteDef('site.stockton')?.storage.goodsCu).toBe(40);
    const hold = [{ good: 'good.iron_ore', qty: 50 }];
    expect(stashGoods(hold, h, 0, 50)).toEqual({ ok: true, good: 'good.iron_ore', qty: 40 });
    expect(stashGoods(hold, h, 0, 1)).toEqual({ ok: false, reason: 'noRoomStash' });
    expect(hold).toEqual([{ good: 'good.iron_ore', qty: 10 }]);
  });

  it('keeps cash in the strongbox, apart from the purse', () => {
    const player = { purse: 15_000 };
    const h = fresh();
    expect(stashCash(player, h, 10_000)).toEqual({ ok: true, cents: 10_000 });
    expect(stashCash(player, h, 6_000)).toEqual({ ok: false, reason: 'noMoney' });
    expect(takeCash(player, h, 12_000)).toEqual({ ok: false, reason: 'noCash' });
    expect(takeCash(player, h, 2_500)).toEqual({ ok: true, cents: 2_500 });
    expect(player.purse).toBe(7_500);
    expect(stashedCash({ a: h, b: { ...fresh(), storage: { goods: [], cash: 5 } } })).toBe(7_505);
    expect(stashCash(player, h, 1.5)).toEqual({ ok: false, reason: 'badQty' });
  });
});

describe('lying at anchor (piece E)', () => {
  const calm: LieCheck = {
    moored: 'anchored',
    speedMs: 0,
    dragging: false,
    aground: false,
    shelter01: 0.6,
    windKn: 14,
    nearestUnderWayM: Number.POSITIVE_INFINITY,
  };

  it('is refused under way, dragging, exposed, aground or with a ship in sight', () => {
    expect(lieRefusal(calm)).toBeUndefined();
    expect(lieRefusal({ ...calm, moored: 'no' })).toBe('underWay');
    expect(lieRefusal({ ...calm, speedMs: 2 })).toBe('underWay');
    expect(lieRefusal({ ...calm, dragging: true })).toBe('dragging');
    expect(lieRefusal({ ...calm, aground: true })).toBe('aground');
    expect(lieRefusal({ ...calm, shelter01: 0.1 })).toBe('exposed');
    // Light airs, or alongside a pier, need no lee.
    expect(lieRefusal({ ...calm, shelter01: 0.1, windKn: 4 })).toBeUndefined();
    expect(lieRefusal({ ...calm, shelter01: 0, moored: 'docked' })).toBeUndefined();
    expect(lieRefusal({ ...calm, nearestUnderWayM: SIGHT_M - 1 })).toBe('shipInSight');
  });

  it('runs on to sunrise or sunset', () => {
    const noon = 12 * 3600;
    const toDusk = secondsUntil('dusk', noon);
    expect(sunAt(noon + toDusk).elevationRad).toBeLessThanOrEqual(0);
    expect(sunAt(noon + toDusk - WORLD_TICK_GAME_SECONDS).elevationRad).toBeGreaterThan(0);
    expect(toDusk / 3600).toBeGreaterThan(6);
    expect(toDusk / 3600).toBeLessThan(10);
    const toDawn = secondsUntil('dawn', noon);
    expect(toDawn).toBeGreaterThan(toDusk);
    expect(sunAt(noon + toDawn).elevationRad).toBeGreaterThan(0);
    let ticks = 0;
    expect(
      lieAtAnchor(
        'dawn',
        noon,
        () => ticks++,
        () => ({ fromRad: 0, speedKn: 10 }),
      ),
    ).toBe(ticks * WORLD_TICK_GAME_SECONDS);
    expect(ticks).toBe(Math.round(toDawn / WORLD_TICK_GAME_SECONDS));
  });

  it('waits for the wind to back or veer 45°, or change 8 kn, for at most a day', () => {
    const w = { fromRad: 0, speedKn: 12 };
    expect(windShifted(w, { fromRad: 0.5, speedKn: 12 })).toBe(false);
    expect(windShifted(w, { fromRad: -0.8, speedKn: 12 })).toBe(true);
    expect(windShifted(w, { fromRad: 6.0, speedKn: 13 })).toBe(false);
    expect(windShifted(w, { fromRad: 0, speedKn: 21 })).toBe(true);
    expect(windShifted({ fromRad: 0, speedKn: 1 }, { fromRad: 3, speedKn: 2 })).toBe(false);
    let n = 0;
    const veering = lieAtAnchor(
      'wind',
      0,
      () => n++,
      () => ({ fromRad: n * 0.05, speedKn: 12 }),
    );
    expect(veering).toBe(16 * WORLD_TICK_GAME_SECONDS);
    expect(
      lieAtAnchor(
        'wind',
        0,
        () => undefined,
        () => w,
      ),
    ).toBe(SECONDS_PER_GAME_DAY);
  });
});

describe('the stash in play (piece E)', () => {
  const setup = (wind = { fromRad: 0, speedKn: 12, shelter01: 0.5 }) => {
    const state = createWorldState('stash-control');
    const ctx = {
      state,
      events: new EventBus<GameEvents>(),
      weather: { windAt: () => ({ gust01: 0, ...wind }), tick: () => undefined },
      sea: {},
    } as unknown as GameContext;
    const { hazards } = createSchooner(0, 0, 0);
    const economy = attachEconomy(ctx, hazards);
    const shown: (StashSnapshot | undefined)[] = [];
    const opens: boolean[] = [];
    const notices: string[] = [];
    const stash = attachStash({
      ctx,
      economy,
      hazards,
      berthPier: (id) => id.replace(/\.(north|south)\d*$/, ''),
      shipPose: () => ({ x: 0, z: 0 }),
      speedMs: () => 0,
      zone: () => undefined,
      nearestUnderWayM: () => Number.POSITIVE_INFINITY,
      showStash: (s) => shown.push(s),
      showLie: () => undefined,
      onOpen: (o) => opens.push(o),
      castOff: () => undefined,
      afterLie: (t) => notices.push(t),
    });
    return { ctx, hazards, stash, shown, opens, notices, economy };
  };

  it('opens alongside the landing and moves cargo and cash, raising StorageChanged', () => {
    const { ctx, hazards, stash, shown, opens, economy } = setup();
    const changes: GameEvents['StorageChanged'][] = [];
    ctx.events.on('StorageChanged', (e) => changes.push(e));
    ctx.events.emit('ShipDocked', { shipId: 'ship.player', berthId: 'pier.bayfield_city.north' });
    expect(stash.openHideout).toBeUndefined();
    ctx.events.emit('ShipDocked', {
      shipId: 'ship.player',
      berthId: 'pier.stockton_landing.north',
    });
    hazards.state.mooring = 'docked';
    expect(stash.openHideout).toBe('hideout.stockton');
    expect(opens).toEqual([true]);
    expect(shown.at(-1)?.siteName).toBe('Presque Isle bay, Stockton Island');
    expect(shown.at(-1)?.stashCapacity).toBe(40);

    economy.syncLoad();
    const load = hazards.state.cargo01;
    expect(stash.actions.stash(0, 5)).toBeUndefined();
    expect(hazards.state.cargo01).toBeLessThan(load);
    expect(stash.actions.stashCash(10_000)).toBeUndefined();
    expect(stash.actions.takeCash(20_000)).toBe("There isn't that much in the strongbox.");
    expect(shown.at(-1)).toMatchObject({ purseCents: 5_000, cashCents: 10_000, holdUsed: 0 });
    expect(stash.actions.take(0, 2)).toBeUndefined();
    expect(changes).toEqual([
      { hideout: 'hideout.stockton', direction: 'in', good: 'good.rope_canvas', qty: 5 },
      { hideout: 'hideout.stockton', direction: 'in', cents: 10_000 },
      { hideout: 'hideout.stockton', direction: 'out', good: 'good.rope_canvas', qty: 2 },
    ]);
    stash.close();
    expect(stash.hideoutHere).toBe('hideout.stockton');
    expect(stash.openHere()).toBe(true);
    stash.close();
    ctx.events.emit('ShipCastOff', {
      shipId: 'ship.player',
      berthId: 'pier.stockton_landing.north',
    });
    hazards.state.mooring = 'free';
    expect(stash.openHere()).toBe(false);
  });

  it('lies at anchor through the world ticks, then notes it and saves', () => {
    const { ctx, hazards, stash, notices } = setup();
    let ticks = 0;
    ctx.events.on('WorldTick', () => ticks++);
    expect(stash.openLie()).toBe('Anchor or come alongside first.');
    hazards.state.anchor = 'down';
    expect(stash.openLie()).toBeUndefined();
    expect(stash.lieOpen).toBe(true);
    const t0 = ctx.state.environment.clock.gameSeconds;
    expect(stash.actions.lie('dusk')).toBeUndefined();
    const passed = ctx.state.environment.clock.gameSeconds - t0;
    expect(passed).toBeGreaterThan(0);
    expect(ticks).toBe(passed / WORLD_TICK_GAME_SECONDS);
    expect(stash.lieOpen).toBe(false);
    expect(notices.at(-1)).toMatch(/^You lay at anchor until dusk/);
  });

  it('refuses an exposed anchorage in a blow', () => {
    const { hazards, stash } = setup({ fromRad: 0, speedKn: 20, shelter01: 0.05 });
    hazards.state.anchor = 'down';
    expect(stash.openLie()).toBe('Too exposed here: find a lee out of this wind.');
  });
});

const dir = join(__dirname, '..', 'public', 'world', 'apostles');
const baked =
  existsSync(join(dir, 'manifest.json')) &&
  readFileSync(join(dir, 'height', '0-0.bin')).byteLength > 200;

describe('the stash on the baked Apostles (piece E)', () => {
  let zone: LoadedZone;
  beforeAll(async () => {
    if (!baked) return;
    zone = await loadZoneTerrain(async (path) => new Uint8Array(readFileSync(join(dir, path))));
  });

  it.skipIf(!baked)('has an anchorage the T1 can anchor in, in the lee of a northwester', () => {
    const frame = manifestFrame(zone.manifest);
    const site = siteDef('site.stockton');
    if (!site) throw new Error('no site');
    const a = siteAnchorage(site, frame);
    if (!a) throw new Error('no anchorage');
    const depth = zone.terrain.depthAt(a.x, a.z);
    expect(depth).toBeGreaterThan(3);
    expect(depth).toBeLessThan(30);
    expect(siteAnchoredAt('zone.apostles', frame, a)?.id).toBe('site.stockton');
    expect(siteAnchoredAt('zone.apostles', frame, { x: a.x + 500, z: a.z })).toBeUndefined();
    const nw = (315 * Math.PI) / 180;
    expect(zone.terrain.shelterAt(a.x, a.z, nw)).toBeGreaterThan(0.3);
  });

  it.skipIf(!baked)('stands the shack, strongbox and shed on dry ground by the landing', () => {
    const l = layoutHarbors(manifestFrame(zone.manifest), zone.terrain).find(
      (x) => x.def.id === 'harbor.stockton',
    );
    expect(l?.buildings.map((b) => b.kind)).toEqual(['shack', 'strongbox', 'storageShed']);
    for (const b of l?.buildings ?? [])
      expect(zone.terrain.heightAt(b.x, b.z)).toBeGreaterThan(0.5);
    expect(l?.piers.map((p) => p.site)).toEqual(['site.stockton']);
  });
});
