/* eslint-disable @typescript-eslint/no-non-null-assertion -- lookups of things just made */
// Phase 9 piece G (plan 11 §18.4, plan 09 §7.1, plan 10 §5): the sail loft, smokehouse,
// powder room and cartography table craft their recipes (exit criterion 7), and the
// loft's sails and blocks and the table's charts fit at the slipway and do what they say.

import { describe, expect, it } from 'vitest';
import { SECONDS_PER_GAME_DAY } from '../src/core/time';
import type { CargoStack } from '../src/sim/economy/hold';
import { packGrid, unpackGrid } from '../src/sim/hideouts/grid';
import {
  builtStations,
  craft,
  craftRefusal,
  recipesAt,
  RECIPES,
  settleProduction,
  STATIONS,
  takeThing,
  withWorkshop,
} from '../src/sim/hideouts/crafting';
import { installAtSlipway, installRefusal, withSlipway } from '../src/sim/hideouts/slipway';
import { starterLayout, type HideoutState } from '../src/sim/hideouts/stash';
import { structure } from '../src/sim/hideouts/structures';
import {
  canvasFactor,
  hullRangeM,
  quietFactor,
  type Conditions,
  type ObserverSpec,
  type Target,
} from '../src/sim/law/perception';
import { lightAirFactorAt, updateTargetSpeed } from '../src/sim/sailing/controller';
import { defaultHandling } from '../src/sim/sailing/handling';
import { defaultHazardRules } from '../src/sim/sailing/hazard-rules';
import { compileSailingClass } from '../src/sim/sailing/ship-class';
import { sailShipRecord, T1_SCHOONER_ID } from '../src/sim/sailing/ships';
import { BASE_INSTRUMENTS, fitShip, stealthOf, upgradeDef } from '../src/sim/shipyard/fit';
import { defaultShipState } from '../src/sim/shipyard/shipyard';

const lot = (good: string, qty: number): CargoStack => ({ good, qty });
const opts = { crewTier: 1, gameSeconds: 0 };
const work = { crewTier: 1, gameSeconds: 0 };

/** Stockton's shack with all eight stations, a well and a slipway. */
function hideout(goods: CargoStack[] = [], things: Record<string, number> = {}): HideoutState {
  return {
    siteId: 'site.stockton',
    claimedAt: 0,
    storage: { goods, cash: 0, things },
    layout: withSlipway(withWorkshop(starterLayout('site.stockton')), 'site.stockton'),
  };
}

const NEW = [
  'station.sail_loft',
  'station.smokehouse',
  'station.powder_room',
  'station.cartography',
] as const;

describe('the four Phase 9 stations', () => {
  it('are pieces that name them, built beside the shack in the dev workshop', () => {
    for (const id of NEW) {
      const st = STATIONS.find((s) => s.id === id)!;
      expect(st, id).toBeDefined();
      expect(structure(st.piece).functions.station).toBe(id);
      expect(recipesAt(id).length, id).toBeGreaterThan(0);
    }
    const built = builtStations(hideout());
    for (const id of NEW) expect(built.has(id), id).toBe(true);
  });

  it('every recipe at them can be made with its makings (criterion 7)', () => {
    for (const id of NEW) {
      for (const r of recipesAt(id)) {
        const goods = Object.entries(r.inputs.goods ?? {}).map(([g, n]) => lot(g, n));
        const h = hideout(goods, { ...r.inputs.things });
        const done = craft(h, r.id, 1, [h.storage.goods], opts);
        expect(done.ok, r.id).toBe(true);
      }
    }
  });

  it('makes no new goods (plan 11 §18.4 G)', () => {
    const made = RECIPES.filter((r) => (NEW as readonly string[]).includes(r.station)).flatMap(
      (r) => Object.keys(r.output.goods ?? {}),
    );
    // Piece V's smoked venison is the one new good (plan 11 §18.20).
    expect(new Set(made)).toEqual(
      new Set(['good.salted_fish', 'good.powder_shot', 'good.smoked_venison']),
    );
  });
});

describe('the sail loft', () => {
  it('cuts five mend kits from a bolt where the bench gets three', () => {
    const h = hideout([lot('good.rope_canvas', 1)]);
    expect(craft(h, 'recipe.loft_mend_kits', 1, [h.storage.goods], opts).ok).toBe(true);
    expect(h.storage.things).toEqual({ 'store.mend_kit': 5 });
    expect(takeThing(h, { stores: {} }, 'store.mend_kit', 5)).toMatchObject({ ok: true });
  });

  it('makes the five rig upgrades, each for the slipway', () => {
    const ids = recipesAt('station.sail_loft').flatMap((r) => Object.keys(r.output.things ?? {}));
    for (const u of [
      'upgrade.quality_canvas',
      'upgrade.topsails',
      'upgrade.storm_sails',
      'upgrade.dark_sails',
      'upgrade.muffled_blocks',
    ]) {
      expect(ids, u).toContain(u);
      expect(upgradeDef(u)!.sources, u).toContain('hideout');
    }
    // The yard still sells canvas and storm sails; the rest are only made at home.
    expect(upgradeDef('upgrade.quality_canvas')!.sources).toContain('shipyard');
    expect(upgradeDef('upgrade.dark_sails')!.sources).toEqual(['hideout']);
  });

  it('tans sails only with water to hand', () => {
    const h = hideout([lot('good.rope_canvas', 4), lot('good.lumber', 1)]);
    const grid = unpackGrid(h.layout);
    grid.remove(grid.all().find((p) => p.piece.id === 'build.well')!.uid);
    h.layout = packGrid(grid);
    expect(craftRefusal(h, 'recipe.dark_sails', 1, [h.storage.goods])).toBe('noWater');
  });

  it('fits loft-made sails at the slipway (criterion 7)', () => {
    const h = hideout([], { 'upgrade.dark_sails': 1, 'upgrade.muffled_blocks': 1 });
    const ship = defaultShipState();
    const r = installAtSlipway(h, ship, 'upgrade.dark_sails', work);
    expect(r).toEqual({ ok: true, event: { upgrade: 'upgrade.dark_sails', seconds: 8 * 3600 } });
    expect(installAtSlipway(h, ship, 'upgrade.muffled_blocks', work).ok).toBe(true);
    expect(ship.upgrades).toEqual(['upgrade.dark_sails', 'upgrade.muffled_blocks']);
    // A T1 has one rigging slot: the tanned suit is it.
    h.storage.things = { 'upgrade.topsails': 1 };
    expect(installRefusal(h, ship, 'upgrade.topsails')).toBe('noSlot');
  });
});

describe('what the loft’s work does', () => {
  const t1 = sailShipRecord(T1_SCHOONER_ID);
  const rules = defaultHazardRules();

  it('topsails: 10% faster at Full in light airs, nothing in a blow or under Half', () => {
    const fit = fitShip(t1, rules, ['upgrade.topsails']);
    const c = compileSailingClass(fit.record, defaultHandling());
    expect(c.lightAirMul).toBeCloseTo(1.1);
    expect(lightAirFactorAt(c, 3, 10)).toBeCloseTo(1.1);
    expect(lightAirFactorAt(c, 3, 16)).toBeCloseTo(1.05);
    expect(lightAirFactorAt(c, 3, 20)).toBe(1);
    expect(lightAirFactorAt(c, 2, 10)).toBe(1);
    // Full strains from 16 knots, not 19.
    expect(fit.rules.safeWindKn[3]).toBe(rules.safeWindKn[3] - 3);
    // In the controller: the same breeze, a tenth faster.
    const plain = compileSailingClass(t1, defaultHandling());
    const state = () =>
      ({
        heading: 0,
        sailSetting: 3,
        manualTrim: false,
        trim: 0.5,
        riggingCondition: 1,
        loadFactor: 1,
        iceFactor: 1,
      }) as unknown as Parameters<typeof updateTargetSpeed>[0];
    const wind = { fromRad: Math.PI / 2, speedKn: 10, gust01: 0 };
    const a = updateTargetSpeed(state(), plain, wind, 0);
    const b = updateTargetSpeed(state(), c, wind, 0);
    expect(b / a).toBeCloseTo(1.1);
  });

  const deck: ObserverSpec = { eyeM: 4, spyglass: false, vigilance: 1 };
  const sky = (sun: number): Conditions => ({
    sky: { sunElevationRad: sun, moonElevationRad: 0.6, moonIllumination01: 1, cloud01: 0 },
    fogM: Infinity,
    rain01: 0,
  });
  const her = (upgrades: string[], sails01 = 1): Target => ({
    tier: 1,
    sails01,
    lanternLit: false,
    ...stealthOf(upgrades),
  });

  it('dark-tanned sails: seen a quarter less far at night, the same by day', () => {
    const night = sky(-0.5);
    const day = sky(0.8);
    const r = (u: string[], c: Conditions) => hullRangeM(her(u), c, deck, 'sky');
    expect(r(['upgrade.dark_sails'], night) / r([], night)).toBeCloseTo(0.75);
    expect(r(['upgrade.dark_sails'], day) / r([], day)).toBeCloseTo(1);
  });

  it('topsails: seen a tenth further with all sail set, not furled', () => {
    expect(canvasFactor(her(['upgrade.topsails']), 1)).toBeCloseTo(1.1);
    expect(canvasFactor(her(['upgrade.topsails'], 0), 1)).toBeCloseTo(1);
  });

  it('muffled blocks: a watcher close in at night is slower, not one far off or by day', () => {
    const m = her(['upgrade.muffled_blocks']);
    expect(quietFactor(her([]), 0, 100)).toBe(1);
    expect(quietFactor(m, 0, 100)).toBeCloseTo(0.65);
    expect(quietFactor(m, 0, 400)).toBeCloseTo(0.825);
    expect(quietFactor(m, 0, 800)).toBe(1);
    expect(quietFactor(m, 1, 100)).toBe(1);
  });
});

describe('the smokehouse', () => {
  const WEEK = SECONDS_PER_GAME_DAY;

  it('cures fish while you’re away, a batch a week, with water and barrels', () => {
    const h = hideout([lot('good.fresh_fish', 6), lot('good.lumber', 2)], { 'item.barrel': 4 });
    const r = craft(h, 'recipe.smoked_fish', 2, [h.storage.goods], { ...opts, gameSeconds: 0 });
    expect(r.ok && r.seconds).toBe(0);
    expect(h.stations!['station.smokehouse']!.queue).toHaveLength(2);
    settleProduction(h, 1.5 * WEEK);
    expect(h.storage.goods).toEqual([lot('good.salted_fish', 3)]);
    settleProduction(h, 10 * WEEK);
    expect(h.storage.goods).toEqual([lot('good.salted_fish', 6)]);
  });

  it('wants water', () => {
    const h = hideout([lot('good.fresh_fish', 3), lot('good.lumber', 1)], { 'item.barrel': 2 });
    const grid = unpackGrid(h.layout);
    grid.remove(grid.all().find((p) => p.piece.id === 'build.well')!.uid);
    h.layout = packGrid(grid);
    expect(craftRefusal(h, 'recipe.smoked_fish', 1, [h.storage.goods])).toBe('noWater');
  });
});

describe('the powder room', () => {
  it('makes four kegs in four hours, where the forge takes two hours a keg', () => {
    const h = hideout([lot('good.hardware', 3), lot('good.coal', 3)]);
    const r = craft(h, 'recipe.powder_kegs', 1, [h.storage.goods], opts);
    expect(r.ok && r.seconds).toBe(4 * 3600);
    expect(h.storage.goods).toEqual([lot('good.powder_shot', 4)]);
    const forge = RECIPES.find((x) => x.id === 'recipe.shot')!;
    expect(forge.hours / (forge.output.goods!['good.powder_shot'] ?? 1)).toBe(2);
  });

  it('needs the smithy too, to cast the shot', () => {
    const h = hideout([lot('good.hardware', 3), lot('good.coal', 3)]);
    const grid = unpackGrid(h.layout);
    grid.remove(grid.all().find((p) => p.piece.id === 'build.smithy')!.uid);
    h.layout = packGrid(grid);
    expect(craftRefusal(h, 'recipe.powder_kegs', 1, [h.storage.goods])).toBe('noPartner');
  });
});

describe('the cartography table', () => {
  it('draws corrected charts: an instrument that runs chart voyages 8% faster', () => {
    const h = hideout([lot('good.dry_goods', 1)]);
    expect(craft(h, 'recipe.corrected_charts', 1, [h.storage.goods], opts).ok).toBe(true);
    expect(h.storage.things).toEqual({ 'upgrade.corrected_charts': 1 });
    const ship = defaultShipState();
    expect(installAtSlipway(h, ship, 'upgrade.corrected_charts', work).ok).toBe(true);
    const t1 = sailShipRecord(T1_SCHOONER_ID);
    expect(BASE_INSTRUMENTS.chartSpeedMul).toBe(1);
    expect(fitShip(t1, defaultHazardRules(), ship.upgrades).instruments.chartSpeedMul).toBe(1.08);
  });
});
