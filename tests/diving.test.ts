import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { gameEconomy } from '../src/sim/economy/defs';
import {
  beyondGrapple,
  diveChance,
  diveRefusal,
  diveWreck,
  freshSalvage,
  oldWrecks,
  progressOf,
  SALVAGE_RULES,
} from '../src/sim/salvage';
import { hasDivingSuit, upgradeDef } from '../src/sim/shipyard/fit';
import { defaultShipState, installUpgrade, soldAt } from '../src/sim/shipyard/shipyard';
import { createWorldState } from '../src/sim/world-state';
import { yardSnapshot } from '../src/ui/port/shipyard-model';
import { chartToZone } from '../src/core/coords';
import { worldChart } from '../src/sim/discovery/discovery';
import salvageFile from '../data/salvage.json';
import apostles from '../public/world/apostles/manifest.json';

/** Phase 10: the hard-hat diving suit and the deep wrecks (plan 11 §6.2, plan 10 §5.7). */

const R = SALVAGE_RULES;
const D = R.dive;
const SUIT = 'upgrade.diving_suit';
const target = (qty = 60) => ({
  id: 'w',
  cargo: [{ good: 'good.copper', qty }],
  papers: true,
  curio: 'curio.chronometer',
  ageDays: 4000,
});
const calm = { depthM: 24, hsM: 0.2, holdFree: 20, pickedClean: false };

describe('the suit', () => {
  it('is dear, utility, transferable, and sold only at Duluth and Superior', () => {
    const u = upgradeDef(SUIT);
    expect(u?.category).toBe('utility');
    expect(u?.transferable).toBe(true);
    expect(u?.priceCents).toBeGreaterThanOrEqual(50_000);
    expect(u && soldAt(u, 'port.superior')).toBe(true);
    expect(u && soldAt(u, 'port.duluth')).toBe(true);
    expect(u && soldAt(u, 'port.bayfield')).toBe(false);
    expect(hasDivingSuit([SUIT])).toBe(true);
    expect(hasDivingSuit(['upgrade.heavy_anchor'])).toBe(false);
  });

  it('is refused away from those ports, and not offered there', () => {
    const defs = gameEconomy();
    const owner = { purse: 1_000_000, cargo: [], stores: {} };
    const ship = defaultShipState();
    expect(installUpgrade(defs, owner, ship, 'port.bayfield', SUIT, 'chandlery')).toEqual({
      ok: false,
      reason: 'notHere',
    });
    expect(installUpgrade(defs, owner, ship, 'port.duluth', SUIT, 'chandlery').ok).toBe(true);
    const state = createWorldState('suit');
    const rows = (port: string) =>
      yardSnapshot({
        defs,
        markets: state.markets,
        owner,
        ship: defaultShipState(),
        shipName: 'Wren',
        port,
        place: 'chandlery',
        gameSeconds: 0,
      }).upgrades.map((u) => u.id);
    expect(rows('port.superior')).toContain(SUIT);
    expect(rows('port.bayfield')).not.toContain(SUIT);
  });
});

describe('deep wrecks', () => {
  it('lie past the grapple and within the hose: the Antelope and two of the run’s own', () => {
    const ws = oldWrecks('deep-run');
    const deep = ws.filter((w) => w.deep);
    expect(deep.map((w) => w.id)).toEqual(['wreck.antelope', 'wreck.deep_1', 'wreck.deep_2']);
    // Richer than the shallow ones, and one carries the chronometer.
    expect(deep.some((w) => w.curio === 'curio.chronometer')).toBe(true);
    expect(beyondGrapple(R, true, 5)).toBe(true);
    expect(beyondGrapple(R, false, R.maxDepthM + 1)).toBe(true);
    expect(beyondGrapple(R, false, R.maxDepthM - 1)).toBe(false);
  });

  it('refuses a dive too deep, picked clean, in a sea, or with a full hold', () => {
    expect(diveRefusal(R, calm)).toBeUndefined();
    expect(diveRefusal(R, { ...calm, depthM: D.maxDepthM + 5 })).toMatch(/hose/);
    expect(diveRefusal(R, { ...calm, pickedClean: true })).toMatch(/picked clean/);
    expect(diveRefusal(R, { ...calm, hsM: D.maxHsM + 0.1 })).toMatch(/Too much sea/);
    expect(diveRefusal(R, { ...calm, holdFree: 0 })).toMatch(/No room/);
    expect(diveRefusal(R, { ...calm, holdFree: 0, findsLeft: true })).toBeUndefined();
  });

  it('finds less by lamp at night and in an old wreck', () => {
    const day = diveChance(R, { daylight: 1, ageYears: 1 });
    expect(day).toBe(D.chance);
    expect(diveChance(R, { daylight: 0, ageYears: 1 })).toBeLessThan(day);
    expect(diveChance(R, { daylight: 1, ageYears: 20 })).toBeLessThan(day);
  });
});

describe('the seeded spots', () => {
  // The zone's baked terrain is centered on its frame; a wreck past its edge never shows up
  // (the salvage sites need a depth there), so a seed that drew her lost a wreck.
  it('all lie inside the Apostles terrain, clear of its edge', () => {
    const { frame } = apostles;
    const margin = 350;
    const spots = [...salvageFile.seeded.spots, ...salvageFile.seeded.deep.spots];
    for (const spot of spots) {
      const p = chartToZone(worldChart(spot.at), frame);
      expect(Math.abs(p.x), spot.where).toBeLessThan(frame.sizeX / 2 - margin);
      expect(Math.abs(p.z), spot.where).toBeLessThan(frame.sizeZ / 2 - margin);
    }
  });
});

describe('a dive', () => {
  const unsnagged = (crewed: boolean, hsM = 0.2) => {
    for (let i = 0; i < 50; i++) {
      const r = diveWreck(
        R,
        target(),
        progressOf(freshSalvage(), 'w', 0),
        { chance: 1, crewed, hsM },
        Rng.fromSeed(`dive|${i}`),
        200,
        0,
      );
      if (!r.snagged) return r;
    }
    throw new Error('always snagged');
  };

  it('gives a crew on the pump three times a lone captain’s trips', () => {
    const solo = unsnagged(false);
    const crew = unsnagged(true);
    expect(solo.trips).toBe(Math.floor(D.airMinutes.solo / D.tripMinutes));
    expect(crew.trips).toBe(Math.floor(D.airMinutes.crewed / D.tripMinutes));
    expect(crew.minutes).toBe(D.dressMinutes + crew.trips * D.tripMinutes);
    expect(crew.finds).toHaveLength(crew.trips);
  });

  it('brings up more of her than a cast of the grapple, and her papers and curio', () => {
    const r = unsnagged(true);
    const cu = r.finds.reduce((n, f) => n + (f.kind === 'cargo' ? f.sound + f.spoiled : 0), 0);
    expect(cu).toBeGreaterThan(R.haulCu[1] * 2);
    const all = new Set<string>();
    for (let i = 0; i < 10; i++) {
      const p = progressOf(freshSalvage(), 'w', 0);
      for (let k = 0; k < 3; k++)
        for (const f of diveWreck(
          R,
          target(),
          p,
          { chance: 1, crewed: true, hsM: 0.2 },
          Rng.fromSeed(`finds|${i}|${k}`),
          200,
          0,
        ).finds)
          all.add(f.kind);
    }
    expect([...all].sort()).toEqual(['cargo', 'curio', 'papers']);
  });

  it('is cut short when she pitches, and a snag costs a trip and time', () => {
    const calmDive = unsnagged(true);
    const pitching = unsnagged(true, D.pitchHsM + 0.05);
    expect(pitching.cutShort).toBe(true);
    expect(pitching.trips).toBeLessThan(calmDive.trips);
    let snag;
    for (let i = 0; i < 200 && !snag; i++) {
      const r = diveWreck(
        R,
        target(),
        progressOf(freshSalvage(), 'w', 0),
        { chance: 1, crewed: true, hsM: 0.2 },
        Rng.fromSeed(`snag|${i}`),
        200,
        0,
      );
      if (r.snagged) snag = r;
    }
    expect(snag?.trips).toBe(calmDive.trips - 1);
    expect(snag?.minutes).toBe(
      D.dressMinutes + (calmDive.trips - 1) * D.tripMinutes + D.snagMinutes,
    );
  });

  it('stops when she’s picked clean, and keeps what won’t fit in her', () => {
    const p = progressOf(freshSalvage(), 'w', 0);
    const small = {
      id: 'w',
      cargo: [{ good: 'good.iron_ore', qty: 4 }],
      papers: false,
      ageDays: 0,
    };
    const r = diveWreck(
      R,
      small,
      p,
      { chance: 1, crewed: true, hsM: 0 },
      Rng.fromSeed('s'),
      200,
      0,
    );
    expect(r.trips).toBeLessThanOrEqual(2);
    const full = diveWreck(
      R,
      target(),
      progressOf(freshSalvage(), 'w', 0),
      { chance: 1, crewed: true, hsM: 0 },
      Rng.fromSeed('full'),
      3,
      0,
    );
    const sound = full.finds.reduce((n, f) => n + (f.kind === 'cargo' ? f.sound : 0), 0);
    expect(sound).toBeLessThanOrEqual(3);
  });
});
