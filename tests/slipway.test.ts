/* eslint-disable @typescript-eslint/no-non-null-assertion -- lookups of things just placed */
// Phase 8 piece G (plan 09 §7.4, §16.4; plan 10 §8–9): the slipway's slope, full repairs,
// installing crafted upgrades, and the schooner built when shipless. The baked checks skip
// when the zones aren't checked out (LFS pointers only).

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BuildGrid,
  packGrid,
  unpackGrid,
  type BuildSite,
  type Piece,
} from '../src/sim/hideouts/grid';
import { buildSiteOf, siteFootprint, siteFrame } from '../src/sim/hideouts/site-frame';
import {
  buildShipAtSlipway,
  hasSlipway,
  installAtSlipway,
  installRefusal,
  newShipRefusal,
  newShipSeconds,
  repairAtSlipway,
  repairRefusal,
  SLIPWAY,
  SLIPWAY_SPOTS,
  slipwayHead,
  slipwayHideout,
  slipwayRepairQuote,
  upgradesKept,
  withSlipway,
} from '../src/sim/hideouts/slipway';
import { siteDef, starterLayout, type HideoutState } from '../src/sim/hideouts/stash';
import { canPlace, REFUSAL_TEXT } from '../src/sim/hideouts/validity';
import type { CargoStack } from '../src/sim/economy/hold';
import { T1_SCHOONER_ID } from '../src/sim/sailing/ships';
import { defaultShipState } from '../src/sim/shipyard/shipyard';
import { loadZoneTerrain } from '../src/sim/terrain/load';
import { manifestFrame } from '../src/sim/terrain/zones';
import { createWorldState, parseWorldState } from '../src/sim/world-state';

const P = (col: number, row: number, rot = 0): Piece => ({
  id: 'build.slipway',
  col,
  row,
  level: 0,
  rot,
  variant: 0,
  paint: 0,
});
const refusal = (site: BuildSite, p: Piece) => {
  const r = canPlace(new BuildGrid(), site, p);
  return r.ok ? undefined : r.reason;
};

/** A shore falling 0.5 m a meter toward -z, dry from z = 8. */
const shore: BuildSite = {
  cols: 12,
  rows: 10,
  baseM: 2,
  ground: (_x, z) => (z < 8 ? (z - 8) * 0.5 : Math.min(2, (z - 8) * 0.5)),
};

const lot = (good: string, qty: number): CargoStack => ({ good, qty });

function hideout(goods: CargoStack[] = [], things: Record<string, number> = {}): HideoutState {
  return {
    siteId: 'site.stockton',
    claimedAt: 0,
    storage: { goods, cash: 0, things },
    layout: withSlipway(starterLayout('site.stockton'), 'site.stockton'),
  };
}

const work = { crewTier: 1, gameSeconds: 0 };

describe('the slipway on the shore (plan 09 §4.3)', () => {
  it('runs straight down a steady slope from the shore into the water', () => {
    // Rows 1–4: 2.5 m deep at the foot, dry at the head.
    expect(refusal(shore, P(0, 1))).toBeUndefined();
    expect(refusal(shore, P(0, 1, 2))).toBeUndefined();
    // Turned along the shore it would sit level in one depth: no dry head.
    expect(refusal(shore, P(0, 2, 1))).toBe('needsShore');
    // Askew: the shore falls across the ways.
    const across: BuildSite = { ...shore, ground: (x, z) => shore.ground(x, z) + (x < 2 ? 0 : -1) };
    expect(refusal(across, P(0, 1))).toBe('askew');
    // A hump in the ways.
    const hump: BuildSite = {
      ...shore,
      ground: (_x, z) => (z < 4 ? -2 : z < 6 ? -0.8 : z < 8 ? -1.2 : 0.2),
    };
    expect(refusal(hump, P(0, 1))).toBe('uneven');
    // A drop-off: a step too sharp for the cradle.
    const cliff: BuildSite = { ...shore, ground: (_x, z) => (z < 6 ? -2.2 : z < 8 ? -0.2 : 0.3) };
    expect(refusal(cliff, P(0, 1))).toBe('tooSteep');
    for (const r of ['askew', 'uneven', 'tooSteep'] as const) expect(REFUSAL_TEXT[r]).toBeTruthy();
  });
});

const dirs: Record<string, string> = { 'zone.apostles': 'apostles', 'zone.siskiwit': 'siskiwit' };
const baked = (zoneId: string): boolean => {
  const dir = join(__dirname, '..', 'public', 'world', dirs[zoneId]!);
  return (
    existsSync(join(dir, 'manifest.json')) &&
    readFileSync(join(dir, 'height', '0-0.bin')).byteLength > 200
  );
};

for (const siteId of ['site.stockton', 'site.siskiwit'] as const) {
  const site = siteDef(siteId)!;
  describe.skipIf(!baked(site.zone))(`a slipway at ${siteId} on the baked shore`, () => {
    it('has room for the ways beside the shack and pier, and the dev spot is one', async () => {
      const dir = join(__dirname, '..', 'public', 'world', dirs[site.zone]!);
      const zone = await loadZoneTerrain(async (p) => new Uint8Array(readFileSync(join(dir, p))));
      const frame = siteFrame(site, siteFootprint(site, manifestFrame(zone.manifest))!);
      const build = buildSiteOf(frame, (x, z) => zone.terrain.heightAt(x, z));
      const g = new BuildGrid();
      for (const p of unpackGrid(starterLayout(siteId)).all()) g.add(p.piece, true);
      let spots = 0;
      for (let rot = 0; rot < 4; rot++)
        for (let c = 0; c < build.cols; c++)
          for (let r = 0; r < build.rows; r++) if (canPlace(g, build, P(c, r, rot)).ok) spots++;
      expect(spots).toBeGreaterThanOrEqual(10);
      const spot = SLIPWAY_SPOTS[siteId]!;
      expect(canPlace(g, build, P(spot.col, spot.row, spot.rot))).toEqual({ ok: true });
      // The head of the ways is dry, the foot over water.
      g.add(P(spot.col, spot.row, spot.rot), true);
      const head = slipwayHead(g, build)!;
      expect(build.ground(head.x, head.z)).toBeGreaterThan(-0.3);
      expect(build.ground(head.seaward.x, head.seaward.z)).toBeLessThan(-1.5);
    });
  });
}

describe('full repairs on the ways (plan 10 §8)', () => {
  it('costs materials in proportion to the damage and makes her sound', () => {
    const ship = { ...defaultShipState(), hull01: 0.5, rigging01: 0.75 };
    const q = slipwayRepairQuote(ship, work);
    expect(q.goods).toEqual({ 'good.lumber': 5, 'good.hardware': 1, 'good.rope_canvas': 2 });
    // 8 h for half a hull and 2 h for a quarter of a rig, in May.
    expect(q.seconds).toBe(10 * 3600);
    const h = hideout([lot('good.lumber', 6), lot('good.hardware', 1)]);
    // Short of rope and canvas in the shed; the hold of a ship moored here makes it up.
    expect(repairRefusal(h, ship, [h.storage.goods], work)).toBe('noGoods');
    const hold = [lot('good.rope_canvas', 3)];
    const r = repairAtSlipway(h, ship, [h.storage.goods, hold], work);
    expect(r.ok).toBe(true);
    expect(ship).toMatchObject({ hull01: 1, rigging01: 1 });
    expect(h.storage.goods).toEqual([lot('good.lumber', 1)]);
    expect(hold).toEqual([lot('good.rope_canvas', 1)]);
    expect(repairRefusal(h, ship, [h.storage.goods], work)).toBe('sound');
  });

  it('goes faster with a crew and slower in November', () => {
    const ship = { ...defaultShipState(), hull01: 0 };
    const may = slipwayRepairQuote(ship, work).seconds;
    expect(slipwayRepairQuote(ship, { ...work, crewTier: 3 }).seconds).toBe(may * 0.5);
    const nov = 190 * 86400; // Game seconds well into November 1900 (a game day is a week).
    expect(slipwayRepairQuote(ship, { crewTier: 1, gameSeconds: nov / 7 }).seconds).toBeGreaterThan(
      may,
    );
  });

  it('needs a built slipway, and a ship', () => {
    const h: HideoutState = { ...hideout(), layout: starterLayout('site.stockton') };
    expect(hasSlipway(h)).toBe(false);
    expect(repairRefusal(h, defaultShipState(), [], work)).toBe('noSlipway');
    expect(repairRefusal(hideout(), undefined, [], work)).toBe('shipless');
    // A slipway still a ghost hauls nothing out.
    const g = unpackGrid(starterLayout('site.stockton'));
    g.add(P(2, 1), false);
    expect(hasSlipway({ ...h, layout: packGrid(g) })).toBe(false);
  });
});

describe('installing crafted upgrades (plan 10 §6)', () => {
  it('fits repair stores from the shed, taking her the upgrade’s hours', () => {
    const h = hideout([], { 'upgrade.repair_stores': 1, 'store.patch_kit': 4 });
    expect(upgradesKept(h)).toEqual([['upgrade.repair_stores', 1]]);
    const ship = defaultShipState();
    const r = installAtSlipway(h, ship, 'upgrade.repair_stores', work);
    expect(r).toEqual({ ok: true, event: { upgrade: 'upgrade.repair_stores', seconds: 4 * 3600 } });
    expect(ship.upgrades).toEqual(['upgrade.repair_stores']);
    expect(h.storage.things).toEqual({ 'store.patch_kit': 4 });
    expect(installRefusal(h, ship, 'upgrade.repair_stores')).toBe('noThing');
  });

  it('refuses what she has, has no slot for, or no gun to carry', () => {
    const h = hideout([], { 'upgrade.repair_stores': 2, 'upgrade.improved_carriages': 1 });
    const ship = { ...defaultShipState(), upgrades: ['upgrade.repair_stores'] };
    expect(installRefusal(h, ship, 'upgrade.repair_stores')).toBe('fitted');
    // Carriages need a gun aboard: small arms don't count.
    expect(installRefusal(h, ship, 'upgrade.improved_carriages')).toBe('noGun');
    const armed = {
      ...ship,
      weapons: [...ship.weapons, { weapon: 'weapon.swivel', mount: 'bow' as const }],
    };
    // No Fame asked: the gear was made at home, not bought from the shady shipwright.
    expect(installRefusal(h, armed, 'upgrade.improved_carriages')).toBeUndefined();
    expect(installRefusal(h, undefined, 'upgrade.repair_stores')).toBe('shipless');
    // A T1 has one utility slot; heavy anchor takes it.
    const full = { ...defaultShipState(), upgrades: ['upgrade.heavy_anchor'] };
    expect(installRefusal(h, full, 'upgrade.repair_stores')).toBe('noSlot');
  });
});

describe('a new schooner when shipless (plan 09 §7.4, §16.5)', () => {
  const materials = () => [
    lot('good.lumber', 32),
    lot('good.hardware', 6),
    lot('good.rope_canvas', 6),
  ];

  it('builds a bare, sound T1 from 30 lumber, 6 hardware and 6 rope and canvas in three days', () => {
    expect(SLIPWAY.newShip.goods).toEqual({
      'good.lumber': 30,
      'good.hardware': 6,
      'good.rope_canvas': 6,
    });
    const h = hideout(materials(), { 'upgrade.repair_stores': 1 });
    const r = buildShipAtSlipway(h, true, [h.storage.goods], 0);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.event.ship).toEqual(defaultShipState(T1_SCHOONER_ID));
    expect(r.event.seconds).toBe(72 * 3600);
    expect(h.storage.goods).toEqual([lot('good.lumber', 2)]);
    // What's stored here can go into her at once.
    expect(installRefusal(h, r.event.ship, 'upgrade.repair_stores')).toBeUndefined();
  });

  it('only for a captain without a ship, with the materials, at a built slipway', () => {
    expect(newShipRefusal(hideout(materials()), false, [materials()])).toBe('hasShip');
    const short = hideout([
      lot('good.lumber', 29),
      lot('good.hardware', 6),
      lot('good.rope_canvas', 6),
    ]);
    expect(newShipRefusal(short, true, [short.storage.goods])).toBe('noGoods');
    const none: HideoutState = { ...hideout(materials()), layout: starterLayout('site.stockton') };
    expect(newShipRefusal(none, true, [none.storage.goods])).toBe('noSlipway');
    // Solo and in late autumn it's slower: half again in November.
    expect(newShipSeconds(0)).toBe(72 * 3600);
  });

  it('chooses the hideout with a slipway nearest the wreck', () => {
    const stockton = hideout();
    const siskiwit: HideoutState = {
      siteId: 'site.siskiwit',
      claimedAt: 0,
      storage: { goods: [], cash: 0 },
      layout: withSlipway(starterLayout('site.siskiwit'), 'site.siskiwit'),
    };
    const both = { 'hideout.stockton': stockton, 'hideout.siskiwit': siskiwit };
    expect(slipwayHideout(both, { lat: 46.93, lon: -90.4 })).toBe('hideout.stockton');
    expect(slipwayHideout(both, { lat: 46.8, lon: -91.4 })).toBe('hideout.siskiwit');
    expect(
      slipwayHideout({
        'hideout.stockton': { ...stockton, layout: starterLayout('site.stockton') },
      }),
    ).toBeUndefined();
  });

  it('keeps being shipless in the save', () => {
    const state = createWorldState('slipway');
    state.player.shipless = { hideout: 'hideout.stockton', since: 3600 };
    const back = parseWorldState(JSON.parse(JSON.stringify(state)));
    expect(back.player.shipless).toEqual({ hideout: 'hideout.stockton', since: 3600 });
    delete state.player.shipless;
    expect(parseWorldState(JSON.parse(JSON.stringify(state))).player.shipless).toBeUndefined();
  });
});
