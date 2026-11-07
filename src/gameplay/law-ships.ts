import type { GameContext } from '../modes/context';
import { METERS_PER_NAUTICAL_MILE, type Chart } from '../core/coords';
import { toWorldChart, type ChartGeography } from '../sim/chart/geography';
import { chartWindAt } from '../sim/chart/chart-weather';
import { patrolLanes, pointAlong, type PatrolLanes, type PatrolRef } from '../sim/chart/patrol';
import { westernSuperiorRoutes } from '../sim/chart/routes';
import type { Contact } from '../sim/chart/traffic';
import { DAY_SPOT_NM } from '../sim/chart/traffic';
import { gameLaw, topWantedTier, type LawDefs } from '../sim/law/defs';
import { tierIn } from '../sim/law/law';
import { CUTTER_CLASS_ID, shipObserver } from '../sim/law/observers';
import {
  advancePatrol,
  charterTug,
  createMorrill,
  planMorrill,
  planTug,
  shelterIfGale,
  sortieWeights,
  type LawShipsState,
  type PatrolWorld,
} from '../sim/law/patrol';
import { daylight01, sight, type Conditions, type Target } from '../sim/law/perception';
import { regionAtChart } from '../sim/law/regions';
import { SHIP_RECORDS } from '../sim/sailing/ships';
import { moonAt, sunAt } from '../sim/weather/celestial';

/**
 * The law's ships on the chart (plan 06 §5.1; Phase 5 piece C). The *Morrill* and, at
 * tier 5, the chartered tug are chart contacts like the traffic, but the planner sails
 * them (`sim/law/patrol.ts`): on every world tick it turns a ship caught out by a gale for
 * shelter, gives every finished leg its successor by Wanted, and charters or pays off the
 * tug. `hunter` is what the chart's encounter check asks: whether she hunts the player
 * (never at tier 0 in the player's region) and how far her lookout makes the ship out,
 * from piece B's perception with the lantern, the sun and moon and the weather.
 */

export const MORRILL_ID = 'ship.morrill';
export const TUG_ID = 'ship.chartered_tug';

/** What the law's ships give the chart's encounter check. */
export interface HunterVerdict {
  /** She hunts the player (Wanted 1+ in the player's region). */
  hunts: boolean;
  /** How far her lookout makes the player out, chart meters. */
  seesAtM: number;
  /** The player's Wanted tier where they are. */
  tier: number;
  region: string;
}

export interface LawShips {
  readonly morrill: Contact;
  readonly tug: Contact;
  /** Both, for the traffic list. */
  readonly contacts: readonly Contact[];
  readonly lanes: PatrolLanes;
  /** The chart's encounter check asks this of a hostile contact (undefined: not ours). */
  hunter(c: Contact, player: Chart, now: number, visibilityM: number): HunterVerdict | undefined;
  /** For the dev overlay. */
  debug(): { state: LawShipsState; weights: { lane: string; weight: number }[] };
  /** Charters the tug in a region now (the dev panel). */
  charter(region: string): boolean;
  dispose(): void;
}

/** A T1 under full sail by day, seen by the cutter: the chart's day range for her lookout. */
const CHART_DAY_SIGHT_M = DAY_SPOT_NM * 0.75 * METERS_PER_NAUTICAL_MILE * 1.25;

function recordOf(classId: string): { conspicuity: number; tier: number } {
  const r = SHIP_RECORDS.find((s) => s.id === classId);
  return { conspicuity: r?.conspicuity ?? 1, tier: r?.tier ?? 1 };
}

export function attachLawShips(
  ctx: GameContext,
  geo: ChartGeography,
  seed: string,
  defs: LawDefs = gameLaw(),
): LawShips {
  const graph = westernSuperiorRoutes();
  const lanes = patrolLanes(geo.projection, graph.lanes, graph.nodes);
  const clock = ctx.state.environment.clock;
  const cutter = defs.actors.cutter;
  const tugDef = defs.actors.tug;

  const state = (): LawShipsState =>
    (ctx.state.lawShips ??= {
      morrill: createMorrill(defs, lanes, clock.gameSeconds),
      tug: null,
    });

  const galeAt = (p: Chart): boolean =>
    chartWindAt(ctx.state.environment.weather, geo, p, clock.gameSeconds).speedKn >= cutter.galeKn;
  const world: PatrolWorld = {
    defs,
    lanes,
    seed,
    tier: (r) => tierIn(defs, ctx.state, r),
    gale(at) {
      if (at.node) {
        const n = graph.nodes.get(at.node);
        return !!n && galeAt(geo.projection.geoToChart({ lon: n.at[0], lat: n.at[1] }));
      }
      const l = at.lane ? lanes.get(at.lane) : undefined;
      return !!l && galeAt(pointAlong(l, at.alongM ?? 0).pos);
    },
  };

  const morrillRef: PatrolRef = { lanes, leg: undefined, speedKn: cutter.speedKn };
  const tugRef: PatrolRef = { lanes, leg: undefined, speedKn: tugDef.speedKn, absent: true };
  const contact = (
    id: string,
    kind: Contact['kind'],
    name: string,
    classId: string,
    speedKn: number,
    patrol: PatrolRef,
  ): Contact => ({
    id,
    kind,
    name,
    classId,
    pos: { x: 0, y: 0 },
    heading: 0,
    speedKn,
    conspicuity: recordOf(classId).conspicuity,
    hostile: true,
    threat: true,
    prize: false,
    patrol,
  });
  const morrill = contact(
    MORRILL_ID,
    'cutter',
    cutter.name,
    cutter.classId,
    cutter.speedKn,
    morrillRef,
  );
  const tug = contact(TUG_ID, 'tug', tugDef.name, tugDef.classId, tugDef.speedKn, tugRef);

  /** Points the contacts at the saved legs (the state object can be replaced on load). */
  const sync = (): void => {
    const s = state();
    morrillRef.leg = s.morrill.leg;
    tugRef.leg = s.tug?.leg;
    tugRef.absent = !s.tug;
  };

  const tick = (now: number): void => {
    const s = state();
    shelterIfGale(world, s.morrill, cutter.speedKn, now, cutter.shelterH);
    advancePatrol(world, s.morrill, cutter.speedKn, now, (m, at) => planMorrill(world, m, at));
    const t = s.tug;
    if (t) {
      if (now >= t.until) {
        s.tug = null;
      } else {
        shelterIfGale(world, t, tugDef.speedKn, now, cutter.shelterH);
        advancePatrol(world, t, tugDef.speedKn, now, (m, at) => planTug(world, t, at));
      }
    }
    sync();
  };

  const charter = (region: string): boolean => {
    const s = state();
    if (s.tug && s.tug.region === region) return false;
    const t = charterTug(world, region, clock.gameSeconds);
    if (!t) return false;
    s.tug = t;
    sync();
    return true;
  };

  const offs = [
    ctx.events.on('WorldTick', ({ gameSeconds }) => tick(gameSeconds)),
    // Tier 5 charters a tug with armed deputies in that region for a few game days (§5.1).
    ctx.events.on('WantedTierChanged', (e) => {
      if (e.to >= Math.min(tugDef.fromTier, topWantedTier(defs)) && e.to > e.from)
        charter(e.region);
    }),
  ];
  tick(clock.gameSeconds);

  const sunOf = (now: number): Conditions['sky'] => {
    const sun = sunAt(now);
    const moon = moonAt(now);
    return {
      sunElevationRad: sun.elevationRad,
      moonElevationRad: moon.elevationRad,
      moonIllumination01: moon.illumination01,
      cloud01: 0.4,
    };
  };
  // The chart's range for her lookout is the zones' perception scaled to the chart's day.
  const dayRef = sight(
    { tier: 1, sails01: 1, lanternLit: false },
    {
      sky: { sunElevationRad: 1, moonElevationRad: -1, moonIllumination01: 0, cloud01: 0 },
      fogM: Infinity,
      rain01: 0,
    },
    shipObserver({ id: 'ref', classId: CUTTER_CLASS_ID, name: '', x: 0, z: 0 }, 1),
    'sky',
    0,
  ).rangeM;

  return {
    morrill,
    tug,
    contacts: [morrill, tug],
    lanes,
    hunter(c, player, now, visibilityM) {
      if (c.id !== MORRILL_ID && c.id !== TUG_ID) return undefined;
      const region = regionAtChart(defs, toWorldChart(geo, player));
      const tier = tierIn(defs, ctx.state, region);
      const p = ctx.state.player;
      const target: Target = {
        tier: recordOf(p.ship?.classId ?? 'ship.t1_schooner').tier,
        sails01: 1,
        lanternLit: !!p.lantern?.lit,
      };
      const sky = sunOf(now);
      const cond: Conditions = { sky, fogM: visibilityM, rain01: 0 };
      const watch = shipObserver(
        { id: c.id, classId: c.classId ?? CUTTER_CLASS_ID, name: c.name, x: 0, z: 0 },
        daylight01(sky.sunElevationRad),
      );
      const s = sight(target, cond, watch, 'sky', 0);
      return {
        hunts: tier >= cutter.inspectsFromTier,
        seesAtM: (s.rangeM / dayRef) * CHART_DAY_SIGHT_M,
        tier,
        region,
      };
    },
    debug() {
      const s = state();
      const l = lanes.get(s.morrill.leg.lane);
      const here = l && (s.morrill.leg.toM <= 0.5 ? l.from.id : l.to.id);
      return { state: s, weights: here ? sortieWeights(world, here) : [] };
    },
    charter,
    dispose() {
      offs.forEach((off) => off());
    },
  };
}
