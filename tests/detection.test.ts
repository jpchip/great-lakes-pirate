import { describe, expect, it } from 'vitest';
import { LIGHTHOUSES, beamBearing, type PlacedLight } from '../src/sim/lighthouses';
import {
  CAN_BURN_GAME_S,
  LAMP_OIL_ID,
  burnLantern,
  createLantern,
  oilNights,
  toggleLantern,
} from '../src/sim/law/lantern';
import {
  ambientSightM,
  awarenessOf,
  createMeter,
  detectability,
  DAY_SIGHT_M,
  hullRangeM,
  IDENTIFIED,
  landBetween,
  lanternRangeM,
  shoreBehind,
  sight,
  SPOT_S,
  SPOTTED,
  stepMeter,
  type Conditions,
  type ObserverSpec,
  type SkyLight,
  type Target,
} from '../src/sim/law/perception';
import {
  beamHit,
  inGlow,
  keeperEyeM,
  keeperObservers,
  keeperVigilance,
  shipObserver,
} from '../src/sim/law/observers';
import { IDENTIFICATION_ORDER } from '../src/sim/law/witness';
import { eyeLabel } from '../src/ui/hud/model';

const DEG = Math.PI / 180;

const NOON: SkyLight = {
  sunElevationRad: 50 * DEG,
  moonElevationRad: -20 * DEG,
  moonIllumination01: 0,
  cloud01: 0,
};
const MOONLESS: SkyLight = {
  sunElevationRad: -30 * DEG,
  moonElevationRad: -30 * DEG,
  moonIllumination01: 0,
  cloud01: 0,
};
const FULL_MOON: SkyLight = { ...MOONLESS, moonElevationRad: 40 * DEG, moonIllumination01: 1 };

const clear = (sky: SkyLight): Conditions => ({ sky, fogM: 25_000, rain01: 0 });
const T1_FULL: Target = { tier: 1, sails01: 1, lanternLit: false };
const DECK: ObserverSpec = { eyeM: 4, spyglass: false, vigilance: 1 };

const raspberry = (): PlacedLight => {
  const def = LIGHTHOUSES.find((l) => l.id === 'light.raspberry');
  if (!def) throw new Error('no Raspberry light');
  return { def, x: 0, z: 0, groundM: 12, seaward: 0 };
};

/** Real seconds for an observer to spot a ship held at `distanceM` (Infinity if never). */
function secondsToSpot(
  target: Target,
  cond: Conditions,
  obs: ObserverSpec,
  distanceM: number,
): number {
  const m = createMeter();
  const s = sight(target, cond, obs, 'sky', distanceM);
  for (let t = 0; t < 600; t += 0.25) {
    stepMeter(m, s, obs.vigilance, 0.25);
    if (m.value >= SPOTTED) return t + 0.25;
  }
  return Infinity;
}

describe('sight ranges (plan 06 §7.1)', () => {
  it('sees a hull 5 km by day, ~300 m on a moonless night and ~2 km under a full moon', () => {
    expect(ambientSightM(NOON)).toBeCloseTo(DAY_SIGHT_M, 0);
    expect(ambientSightM(MOONLESS)).toBeCloseTo(300, 0);
    expect(ambientSightM(FULL_MOON)).toBeGreaterThan(1800);
    expect(ambientSightM(FULL_MOON)).toBeLessThanOrEqual(2000);
  });

  it('an overcast hides the moon', () => {
    expect(ambientSightM({ ...FULL_MOON, cloud01: 1 })).toBeLessThan(ambientSightM(FULL_MOON) / 2);
  });

  it('fog caps what is seen, by day or night', () => {
    const fog = { ...clear(NOON), fogM: 400 };
    expect(hullRangeM(T1_FULL, fog, DECK, 'sky')).toBeLessThanOrEqual(400);
    expect(lanternRangeM({ ...clear(MOONLESS), fogM: 400 })).toBeLessThanOrEqual(500);
  });

  it('a lantern shows nothing by day and 3 km on a dark night', () => {
    expect(lanternRangeM(clear(NOON))).toBe(0);
    expect(lanternRangeM(clear(MOONLESS))).toBeCloseTo(3000, 0);
  });

  it('sails, tier, a high vantage, a glass and a dark shore move the range the right way', () => {
    const c = clear(NOON);
    const base = hullRangeM(T1_FULL, c, DECK, 'sky');
    expect(hullRangeM({ ...T1_FULL, sails01: 0 }, c, DECK, 'sky')).toBeLessThan(base);
    expect(hullRangeM({ ...T1_FULL, tier: 2 }, c, DECK, 'sky')).toBeGreaterThan(base);
    expect(hullRangeM(T1_FULL, c, { ...DECK, eyeM: 30 }, 'sky')).toBeGreaterThan(base);
    expect(hullRangeM(T1_FULL, c, { ...DECK, spyglass: true }, 'sky')).toBeGreaterThan(base);
    expect(hullRangeM(T1_FULL, c, DECK, 'shore')).toBeLessThan(base);
    const night = clear(FULL_MOON);
    expect(hullRangeM(T1_FULL, night, DECK, 'glow')).toBeGreaterThan(
      hullRangeM(T1_FULL, night, DECK, 'sky'),
    );
  });

  it('rain thins it', () => {
    expect(hullRangeM(T1_FULL, { ...clear(NOON), rain01: 1 }, DECK, 'sky')).toBeLessThan(
      hullRangeM(T1_FULL, clear(NOON), DECK, 'sky'),
    );
  });

  it('beyond the hull but inside the lantern, she is seen only by her light', () => {
    const s = sight({ ...T1_FULL, lanternLit: true }, clear(MOONLESS), DECK, 'sky', 2000);
    expect(s.by).toBe('lantern');
    expect(s.canIdentify).toBe(false);
  });
});

describe('§14.3 criterion 4: dark on a moonless night vs. lit under a full moon', () => {
  const keeper: ObserverSpec = { eyeM: keeperEyeM(raspberry()), spyglass: false, vigilance: 0.75 };

  it('the dark ship is seen from a fraction of the distance', () => {
    const dark = detectability(T1_FULL, clear(MOONLESS));
    const lit = detectability({ ...T1_FULL, lanternLit: true }, clear(FULL_MOON));
    expect(lit / dark).toBeGreaterThan(5);
  });

  it('passing Raspberry light 1 km off: dark is never spotted, lit is in seconds', () => {
    expect(secondsToSpot(T1_FULL, clear(MOONLESS), keeper, 1000)).toBe(Infinity);
    const lit = secondsToSpot({ ...T1_FULL, lanternLit: true }, clear(FULL_MOON), keeper, 1000);
    expect(lit).toBeLessThan(15);
  });

  it('even close in, dark takes longer to spot than lit', () => {
    const dark = secondsToSpot(T1_FULL, clear(MOONLESS), keeper, 250);
    const lit = secondsToSpot({ ...T1_FULL, lanternLit: true }, clear(FULL_MOON), keeper, 250);
    expect(dark).toBeGreaterThan(lit);
  });
});

describe('the detection meter (§7.1)', () => {
  it('fills to spotted in SPOT_S alongside, fully alert', () => {
    const m = createMeter();
    const s = { by: 'hull' as const, closeness01: 1, canIdentify: false };
    for (let t = 0; t < SPOT_S - 0.5; t += 0.25) stepMeter(m, s, 1, 0.25);
    expect(m.value).toBeLessThan(SPOTTED);
    for (let t = 0; t < 1; t += 0.25) stepMeter(m, s, 1, 0.25);
    expect(awarenessOf(m)).toBe('spotted');
  });

  it('a dozing keeper is slower than a lookout', () => {
    const s = sight(T1_FULL, clear(FULL_MOON), DECK, 'sky', 600);
    const lookout = createMeter();
    const dozing = createMeter();
    for (let t = 0; t < 10; t += 0.25) {
      stepMeter(lookout, s, 1, 0.25);
      stepMeter(dozing, s, 0.25, 0.25);
    }
    expect(lookout.value).toBeGreaterThan(dozing.value);
  });

  it('only identifies inside identification range, and then only with time', () => {
    const far = sight(T1_FULL, clear(NOON), DECK, 'sky', 4000);
    const m = createMeter();
    for (let t = 0; t < 120; t += 0.25) stepMeter(m, far, 1, 0.25);
    expect(awarenessOf(m)).toBe('spotted');
    const near = sight(T1_FULL, clear(NOON), DECK, 'sky', 500);
    expect(near.canIdentify).toBe(true);
    for (let t = 0; t < 20; t += 0.25) stepMeter(m, near, 1, 0.25);
    expect(m.value).toBe(IDENTIFIED);
    expect(awarenessOf(m)).toBe('identified');
  });

  it('forgets her out of sight, and loses the identification below spotted', () => {
    const m = { value: IDENTIFIED, identified: true, byLanternOnly: false };
    const none = { by: 'none' as const, closeness01: 0, canIdentify: false };
    for (let t = 0; t < 50; t += 0.25) stepMeter(m, none, 1, 0.25);
    expect(m.identified).toBe(false);
    expect(awarenessOf(m)).not.toBe('spotted');
  });

  it('a lantern seen alone marks the spot as a light, not a schooner', () => {
    const s = sight({ ...T1_FULL, lanternLit: true }, clear(MOONLESS), DECK, 'sky', 1500);
    const m = createMeter();
    for (let t = 0; t < 60; t += 0.25) stepMeter(m, s, 1, 0.25);
    expect(m.value).toBe(SPOTTED);
    expect(m.byLanternOnly).toBe(true);
  });

  it('a beam sweeping across her spots her at once', () => {
    const s = sight(T1_FULL, clear(FULL_MOON), DECK, 'sky', 900);
    const m = stepMeter(createMeter(), s, 0.5, 0.25, true);
    expect(m.value).toBe(SPOTTED);
  });
});

describe('keepers and crews (§5.5, §6.1)', () => {
  const def = (keepers: number) => ({ keepers, lit: true });

  it('a lone keeper dozes before dawn; a station of three keeps watch', () => {
    expect(keeperVigilance(def(1), 3, 0)).toBeLessThan(keeperVigilance(def(1), 23, 0) / 2);
    expect(keeperVigilance(def(3), 3, 0)).toBeGreaterThan(0.6);
  });

  it('watches harder at Wanted tier 3+', () => {
    expect(keeperVigilance(def(1), 23, 0, 3)).toBeGreaterThan(keeperVigilance(def(1), 23, 0));
  });

  it('a dark station has no keeper watching', () => {
    expect(keeperVigilance({ keepers: 0, lit: true }, 23, 0)).toBe(0);
    expect(keeperVigilance({ keepers: 2, lit: false }, 23, 0)).toBe(0);
    const dark = LIGHTHOUSES.filter((l) => !l.lit);
    const placed = dark.map((d) => ({ def: d, x: 0, z: 0, groundM: 5, seaward: 0 }));
    expect(keeperObservers(placed, 23, 0)).toHaveLength(0);
  });

  it('every kept light in the data becomes a keeper with its reporting speed', () => {
    const kept = LIGHTHOUSES.filter((l) => l.lit && l.keepers > 0);
    const placed = kept.map((d) => ({ def: d, x: 0, z: 0, groundM: 5, seaward: 0 }));
    const obs = keeperObservers(placed, 22, 0);
    expect(obs).toHaveLength(kept.length);
    for (const o of obs) {
      expect(o.kind).toBe('keeper');
      expect(o.reporting).toBeDefined();
      expect(o.eyeM).toBeGreaterThan(5);
    }
  });

  it('the cutter keeps a lookout with a glass; a freighter a busy watch', () => {
    const cutter = shipObserver(
      { id: 'c', classId: 'ship.cutter_morrill', name: 'Morrill', x: 0, z: 0 },
      0,
    );
    const crew = shipObserver(
      { id: 'f', classId: 'ship.ore_freighter', name: 'Hesper', x: 0, z: 0 },
      0,
    );
    expect(cutter.kind).toBe('cutter');
    expect(cutter.spyglass).toBe(true);
    expect(crew.kind).toBe('crew');
    expect(cutter.vigilance).toBeGreaterThan(crew.vigilance);
  });

  it("Raspberry's beam hits a ship it points at, within range, at night", () => {
    const p = raspberry();
    expect(p.def.characteristic.kind).toBe('flashing');
    const t = 10;
    const b = beamBearing(p.def, t);
    const ship = { x: Math.sin(b) * 1000, z: -Math.cos(b) * 1000 };
    expect(beamHit(p, ship, t, 1)).toBe(true);
    expect(beamHit(p, ship, t, 0)).toBe(false);
    const behind = { x: -ship.x, z: -ship.z };
    expect(beamHit(p, behind, t, 1)).toBe(false);
  });

  it('a ship close under a lit light stands in its glow', () => {
    const p = raspberry();
    expect(inGlow([p], { x: 300, z: 0 }, 1)).toBe(true);
    expect(inGlow([p], { x: 3000, z: 0 }, 1)).toBe(false);
    expect(inGlow([p], { x: 300, z: 0 }, 0)).toBe(false);
  });
});

describe('line of sight over land', () => {
  // An island 20 m high between x = 400 and 600.
  const island = (x: number) => (x > 400 && x < 600 ? 20 : -10);
  const heightAt = (x: number) => island(x);

  it('an island hides her from a deck, not from a tall tower', () => {
    expect(landBetween(heightAt, { x: 0, y: 4, z: 0 }, { x: 1000, y: 6, z: 0 })).toBe(true);
    expect(landBetween(heightAt, { x: 0, y: 60, z: 0 }, { x: 1000, y: 6, z: 0 })).toBe(false);
  });

  it('knows a shore stands behind her', () => {
    expect(shoreBehind(heightAt, { x: 0, z: 0 }, { x: 200, z: 0 })).toBe(true);
    expect(shoreBehind(heightAt, { x: 1000, z: 0 }, { x: 700, z: 0 })).toBe(true);
    expect(shoreBehind(heightAt, { x: 300, z: 0 }, { x: 1000, z: 0 })).toBe(false);
  });
});

describe('the lantern and its oil (plan 02 §2)', () => {
  it("won't light without oil", () => {
    const l = createLantern();
    expect(toggleLantern(l, {})).toBe('noOil');
    expect(l.lit).toBe(false);
  });

  it('opens a can to light, and douses', () => {
    const l = createLantern();
    const stores = { [LAMP_OIL_ID]: 2 };
    expect(toggleLantern(l, stores)).toBe('lit');
    expect(stores[LAMP_OIL_ID]).toBe(1);
    expect(l.fuelS).toBe(CAN_BURN_GAME_S);
    expect(toggleLantern(l, stores)).toBe('doused');
    expect(l.lit).toBe(false);
    // Relighting uses what's in the lamps, not a new can.
    expect(toggleLantern(l, stores)).toBe('lit');
    expect(stores[LAMP_OIL_ID]).toBe(1);
  });

  it('a can is a week of nights, and the lamps go dark when the oil is gone', () => {
    const l = createLantern();
    const stores = { [LAMP_OIL_ID]: 1 };
    toggleLantern(l, stores);
    expect(oilNights(l, stores)).toBeCloseTo(7, 5);
    expect(burnLantern(l, stores, CAN_BURN_GAME_S / 2)).toBe(false);
    expect(oilNights(l, stores)).toBeCloseTo(3.5, 5);
    expect(burnLantern(l, stores, CAN_BURN_GAME_S)).toBe(true);
    expect(l.lit).toBe(false);
    expect(l.fuelS).toBe(0);
  });

  it('burns nothing doused', () => {
    const l = { lit: false, fuelS: 100 };
    const stores = { [LAMP_OIL_ID]: 3 };
    burnLantern(l, stores, 10_000);
    expect(l.fuelS).toBe(100);
    expect(stores[LAMP_OIL_ID]).toBe(3);
  });

  it('opens the next can as one runs dry', () => {
    const l = { lit: true, fuelS: 10 };
    const stores = { [LAMP_OIL_ID]: 2 };
    expect(burnLantern(l, stores, 20)).toBe(false);
    expect(stores[LAMP_OIL_ID]).toBe(1);
    expect(l.fuelS).toBe(CAN_BURN_GAME_S - 10);
  });
});

describe('witnesses for the law core (§2.3)', () => {
  it('orders identifications weakest to strongest', () => {
    expect(IDENTIFICATION_ORDER).toEqual(['unknown', 'schooner', 'ship', 'person']);
  });

  it('the HUD names who is watching in words', () => {
    expect(eyeLabel({ level: 'watching', by: 'Raspberry Island keeper' })).toBe(
      'Watched by Raspberry Island keeper',
    );
    expect(eyeLabel({ level: 'identified', by: 'Morrill' })).toBe('Known to Morrill');
  });
});
