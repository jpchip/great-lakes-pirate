import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll } from 'vitest';
import { ChartProjection, chartToZone } from '../src/core/coords';
import { SECONDS_PER_GAME_DAY } from '../src/core/time';
import { WORLD_PROJECTION } from '../src/sim/chart/geography';
import { laneLonLats, westernSuperiorRoutes } from '../src/sim/chart/routes';
import { counterForEvent } from '../src/sim/character/ambitions';
import { storeItems, storeOffered } from '../src/sim/economy/chandlery';
import { candidates, createEventsState, EVENTS, fireEvent } from '../src/sim/events/events';
import { loadZoneTerrain, type LoadedZone } from '../src/sim/terrain/load';
import { manifestFrame } from '../src/sim/terrain/zones';
import { parseWorldState, createWorldState } from '../src/sim/world-state';
import {
  breakUpChance,
  foolChance,
  freshWrecking,
  investigated,
  MARKS,
  markById,
  moonCussingNight,
  setRig,
  stepWrecking,
  strandedNow,
  WRECK_RULES,
  type MarkConditions,
  type PassingShip,
  type WreckingWorld,
} from '../src/sim/wrecking';

const projection = new ChartProjection();
const HOUR = 3600;
function must<T>(x: T | undefined | null): T {
  if (x === undefined || x === null) throw new Error('missing');
  return x;
}

const sand = must(markById('mark.sand_shoal'));

const GALE_NEW_MOON: MarkConditions = { sunDeg: -30, moon01: 0, visM: 800, windKn: 34 };
const CLEAR_FULL_MOON: MarkConditions = { sunDeg: -30, moon01: 1, visM: 20_000, windKn: 6 };

/**
 * A test world: one ship sails straight past a mark's shoal each `everyS`, from 4 nm off
 * to 4 nm beyond, at 10 knots, under the conditions given.
 */
function world(opts: {
  mark?: typeof sand;
  conditions: MarkConditions | ((t: number) => MarkConditions);
  everyS?: number;
  ships?: number;
  doused?: number;
  keeper?: boolean;
  seed?: string;
}): WreckingWorld {
  const mark = opts.mark ?? sand;
  const shoal = projection.geoToChart(mark.shoal);
  const every = opts.everyS ?? 2 * SECONDS_PER_GAME_DAY;
  const n = opts.ships ?? 1;
  const speed = 10 * 0.514444;
  const runM = 8 * 1852;
  return {
    seed: opts.seed ?? 'wreck-test',
    ships(t) {
      const out: PassingShip[] = [];
      for (let k = 0; k < n; k++) {
        const u = (t + k * 1000) % every;
        const along = u * speed;
        if (along > runM) continue;
        out.push({
          id: `ship.test_${k + 1}`,
          name: `Steamer Test ${k + 1}`,
          classId: 'ship.package_steamer',
          pos: { x: shoal.x - runM / 2 + along, y: shoal.y + 400 },
          underWay: true,
        });
      }
      return out;
    },
    toChart: (p) => projection.geoToChart(p),
    conditions: (_m, t) =>
      typeof opts.conditions === 'function' ? opts.conditions(t) : opts.conditions,
    dousedSince: (light) => (light === mark.light ? opts.doused : undefined),
    keeperWatching: () => opts.keeper ?? true,
    regionOfLight: () => 'region.apostles',
    crewOf: () => 16,
    cargoOf: () => [{ good: 'good.general_freight', qty: 40 }],
  };
}

describe('the odds of a false light', () => {
  it('needs the dark, and does best in a moonless gale', () => {
    const day = { ...GALE_NEW_MOON, sunDeg: 10 };
    expect(foolChance(sand, 'falseLight', day, 0.5)).toBe(0);
    const gale = foolChance(sand, 'falseLight', GALE_NEW_MOON, 0.5);
    const clear = foolChance(sand, 'falseLight', CLEAR_FULL_MOON, 0.5);
    expect(gale).toBeGreaterThan(0.4);
    // A clear night under a full moon mostly sees through it.
    expect(clear).toBeLessThan(0.08);
    expect(clear).toBeGreaterThan(0);
  });

  it('fools a sloppy captain more readily than a sharp one', () => {
    expect(foolChance(sand, 'falseLight', GALE_NEW_MOON, 1)).toBeGreaterThan(
      2 * foolChance(sand, 'falseLight', GALE_NEW_MOON, 0),
    );
  });

  it('lets a doused light fool anyone only in weather, and both together most', () => {
    const quiet = { ...GALE_NEW_MOON, visM: 20_000, windKn: 6 };
    expect(foolChance(sand, 'doused', quiet, 1)).toBe(0);
    expect(foolChance(sand, 'doused', GALE_NEW_MOON, 0.5)).toBeGreaterThan(0);
    expect(foolChance(sand, 'both', GALE_NEW_MOON, 0.5)).toBeGreaterThan(
      foolChance(sand, 'falseLight', GALE_NEW_MOON, 0.5),
    );
  });

  it('breaks ships up only in a blow', () => {
    expect(breakUpChance(10)).toBe(0);
    expect(breakUpChance(WRECK_RULES.weather.galeKn)).toBeCloseTo(WRECK_RULES.breakUp.atGaleChance);
  });
});

describe('the rig', () => {
  const night = (t: number) => (((t / HOUR) % 24) + 24) % 24 >= 21 || (t / HOUR) % 24 < 5;
  const sunDeg = (t: number) => (night(t) ? -20 : 10);

  it('is set only after dark, once a mark, and goes out at dawn', () => {
    const st = freshWrecking(0);
    expect(setRig(st, sand, 12 * HOUR, sunDeg)).toEqual({ ok: false, reason: 'daylight' });
    const r = setRig(st, sand, 22 * HOUR, sunDeg);
    expect(r.ok).toBe(true);
    // 22:00 plus ten hours would be 08:00; the sun's up at 05:00.
    if (r.ok) expect(r.until).toBe(29 * HOUR);
    expect(setRig(st, sand, 23 * HOUR, sunDeg)).toEqual({ ok: false, reason: 'alreadySet' });
  });
});

describe('a night of moon cussing', () => {
  it('puts a laden ship on the shoal on a dark night in weather', () => {
    const st = freshWrecking(0);
    const w = world({ conditions: GALE_NEW_MOON, ships: 6, everyS: 6 * HOUR });
    setRig(st, sand, 0, () => -30);
    const out = stepWrecking(st, w, 10 * HOUR);
    const wrecks = out.filter((o) => o.type === 'stranded' || o.type === 'broken');
    expect(wrecks.length).toBeGreaterThan(0);
    for (const o of wrecks) {
      if (o.type !== 'stranded' && o.type !== 'broken') continue;
      expect(o.stranding.mark).toBe(sand.id);
      expect(o.stranding.cargo).toEqual([{ good: 'good.general_freight', qty: 40 }]);
      expect(o.stranding.drowned).toBeLessThanOrEqual(o.stranding.crew);
    }
    // Each ship is judged once at a trap, however long she takes to pass.
    const keys = st.judged.map((j) => j.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(st.count).toBe(wrecks.length);
  });

  it('judges the same ship the same way after a reload', () => {
    const run = () => {
      const st = freshWrecking(0);
      setRig(st, sand, 0, () => -30);
      const out = stepWrecking(st, world({ conditions: GALE_NEW_MOON, ships: 8 }), 10 * HOUR);
      return out.map((o) => (o.type === 'stranded' || o.type === 'broken' ? o.stranding : o));
    };
    expect(run()).toEqual(run());
  });

  it('leaves the ships alone with no light hung and no light doused', () => {
    const st = freshWrecking(0);
    expect(
      stepWrecking(st, world({ conditions: GALE_NEW_MOON, ships: 6 }), SECONDS_PER_GAME_DAY),
    ).toEqual([]);
  });

  it('lets a stranded ship lie to be boarded until her tug comes', () => {
    const st = freshWrecking(0);
    setRig(st, sand, 0, () => -30);
    const calm = { ...GALE_NEW_MOON, windKn: 12, visM: 900 };
    const out = stepWrecking(
      st,
      world({ conditions: calm, ships: 8, everyS: 6 * HOUR }),
      10 * HOUR,
    );
    const stranded = out.filter((o) => o.type === 'stranded');
    expect(stranded.length).toBeGreaterThan(0);
    expect(strandedNow(st, 10 * HOUR).length).toBe(stranded.length);
    stepWrecking(
      st,
      world({ conditions: calm }),
      (WRECK_RULES.strandedDays + 1) * SECONDS_PER_GAME_DAY,
    );
    expect(strandedNow(st, (WRECK_RULES.strandedDays + 1) * SECONDS_PER_GAME_DAY)).toEqual([]);
  });

  it('is seen by the keeper or the survivors only when they could', () => {
    const st = freshWrecking(0);
    setRig(st, sand, 0, () => -30);
    const out = stepWrecking(
      st,
      world({
        conditions: { ...GALE_NEW_MOON, windKn: 12 },
        ships: 8,
        keeper: false,
        everyS: 6 * HOUR,
      }),
      10 * HOUR,
    );
    for (const o of out) {
      if (o.type !== 'stranded') continue;
      expect(o.witnesses.some((w) => w.kind === 'keeper')).toBe(false);
      // Survivors saw a light where none should be, but not who hung it.
      expect(o.witnesses).toContainEqual({ kind: 'crew', ident: 'unknown' });
    }
  });

  it('opens an investigation after several wrecks near one light', () => {
    const st = freshWrecking(0);
    const w = world({ conditions: GALE_NEW_MOON, ships: 12, everyS: 3 * HOUR, seed: 'many' });
    let opened = false;
    for (let night = 0; night < 4 && !opened; night++) {
      const t0 = night * SECONDS_PER_GAME_DAY;
      setRig(st, sand, t0, () => -30);
      const out = stepWrecking(st, w, t0 + 10 * HOUR);
      opened = out.some((o) => o.type === 'investigation');
    }
    expect(opened).toBe(true);
    expect(investigated(st, 'region.apostles', st.steppedTo)).toBe(true);
    expect(investigated(st, 'region.duluth', st.steppedTo)).toBe(false);
  });

  it('finds a moon-cussing night only with no moon, foul weather and a ship due', () => {
    const w = world({ conditions: GALE_NEW_MOON, everyS: 12 * HOUR });
    expect(moonCussingNight(w, 0, 0.05)).toBeDefined();
    expect(moonCussingNight(w, 0, 0.9)).toBeUndefined();
    expect(moonCussingNight(world({ conditions: CLEAR_FULL_MOON }), 0, 0.05)).toBeUndefined();
  });
});

describe('wrecking in the rest of the game', () => {
  it('makes the rig a store for the lockers that no chandler sells', () => {
    const rig = storeItems().find((s) => s.id === 'store.false_light');
    expect(rig?.crafted).toBe(true);
    expect(storeOffered(must(rig), 5)).toBe(false);
  });

  it('moves a Phase 8 rig in a hideout to the new store on load', () => {
    const s = createWorldState('seed', 0);
    const h = Object.values(s.hideouts ?? {})[0];
    expect(h).toBeDefined();
    must(h).storage.things = { 'item.false_light': 2 };
    const loaded = parseWorldState(JSON.parse(JSON.stringify(s)));
    expect(must(Object.values(loaded.hideouts ?? {})[0]).storage.things).toEqual({
      'store.false_light': 2,
    });
  });

  it('counts a wreck toward the Moon-Cusser', () => {
    expect(counterForEvent('FeatAccomplished', { kind: 'moonCussing' }, 0)).toBe('moonCussings');
  });

  it('fires the moon-cussing night at the ship and mark the world names', () => {
    const def = must(EVENTS.events.find((e) => e.id === 'event.moon_cussing_night'));
    const st = createEventsState(0);
    const ev = {
      now: 18 * HOUR,
      fameTier: 0,
      topWanted: { tier: 0, region: undefined },
      regionOf: () => undefined,
      standing: () => 0,
      gale: () => false,
      hideouts: [],
      hereRegion: 'region.apostles',
      dockedPort: undefined,
    };
    expect(candidates(def, st, ev, 'tick')).toEqual([]);
    const night = {
      ...ev,
      wreckingNight: () => ({
        ship: 'ship.package_line_1',
        name: 'Steamer Hiawatha',
        at: 23 * HOUR,
        mark: 'Sand Island shoal',
        region: 'region.apostles',
      }),
    };
    const places = candidates(def, st, night, 'tick');
    expect(places).toEqual([{ port: undefined, region: 'region.apostles' }]);
    const fired = fireEvent(st, night, def, must(places[0]), () => 0.5);
    expect(fired.shipName).toBe('Steamer Hiawatha');
    expect(fired.markName).toBe('Sand Island shoal');
  });
});

describe('the marks on the Apostles zone', () => {
  const dir = join(__dirname, '..', 'public', 'world', 'apostles');
  const baked =
    existsSync(join(dir, 'manifest.json')) &&
    readFileSync(join(dir, 'height', '0-0.bin')).byteLength > 200;
  let zone: LoadedZone;
  beforeAll(async () => {
    if (!baked) return;
    zone = await loadZoneTerrain(async (path) => new Uint8Array(readFileSync(join(dir, path))));
  });

  it('puts each rig ashore by a shoal a freighter grounds on and a schooner can lie off', () => {
    if (!baked) return;
    const frame = manifestFrame(zone.manifest);
    const h = (p: { lat: number; lon: number }) => {
      const z = chartToZone(WORLD_PROJECTION.geoToChart(p), frame);
      return zone.terrain.heightAt(z.x, z.z);
    };
    for (const m of MARKS) {
      expect(h(m.rig), `${m.id} rig`).toBeGreaterThan(0);
      const depth = -h(m.shoal);
      expect(depth, `${m.id} shoal`).toBeGreaterThan(2);
      // Shallower than a laden package steamer draws.
      expect(depth, `${m.id} shoal`).toBeLessThan(4.3);
    }
  });

  it('puts each mark beside a lane the traffic sails', () => {
    const g = westernSuperiorRoutes();
    const lanes = g.lanes.filter((l) => l.fleet.length > 0);
    for (const m of MARKS) {
      const shoal = projection.geoToChart(m.shoal);
      let best = Infinity;
      for (const lane of lanes) {
        const pts = laneLonLats(g, lane).map(([lon, lat]) => projection.geoToChart({ lat, lon }));
        for (let i = 0; i + 1 < pts.length; i++) {
          const a = must(pts[i]);
          const b = must(pts[i + 1]);
          const vx = b.x - a.x;
          const vy = b.y - a.y;
          const k = Math.max(
            0,
            Math.min(1, ((shoal.x - a.x) * vx + (shoal.y - a.y) * vy) / (vx * vx + vy * vy)),
          );
          best = Math.min(best, Math.hypot(shoal.x - a.x - k * vx, shoal.y - a.y - k * vy));
        }
      }
      expect(best / 1852, m.id).toBeLessThan(WRECK_RULES.passNm);
    }
  });
});
