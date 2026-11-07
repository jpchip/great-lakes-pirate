import { z } from 'zod';
import { SECONDS_PER_GAME_DAY } from '../../core/time';
import { hash01, monthAt } from '../chart/routes';
import {
  legAlongM,
  legArriveAt,
  legDoneAt,
  legUnderWay,
  nodeAt,
  type LegPurpose,
  type PatrolLane,
  type PatrolLanes,
  type PatrolLeg,
} from '../chart/patrol';
import type { LawDefs } from './defs';

/**
 * The law's ships on the lake (plan 06 §5.1; Phase 5 piece C): the revenue cutter
 * *Morrill*'s sorties and, at tier 5, the chartered tug.
 *
 * - **Sorties weighted by Wanted.** From her base (Duluth or Bayfield) she steams out one
 *   of her beats (`law_actors.json` `cutter.beats`), lies a while at its far station and
 *   steams back. Each beat covers regions, and its weight is `baseWeight` plus the pull of
 *   each region's tier: a Hunted region (tier 3+) draws her strongly. A beat from the other
 *   base takes the passage between them first.
 * - **Coaling at Duluth.** After `coalEveryH` hours of sorties she goes back to coal.
 * - **Shelter in gales.** In a gale she won't sail, and one under way runs for the nearer
 *   port at her lane's ends and lies there (storms are windows of opportunity).
 * - **Away to Lake Michigan.** With nothing above `away.maxTier` she sometimes leaves by
 *   the lower lakes for a few game days, off the chart.
 * - **Winter quarters** at Duluth while the ice closes the lake.
 *
 * Each leg is saved (`lawShips` in the world state), so a reload finds her where she was;
 * the draws come from the run's seed and the sortie count.
 */

const legSchema = z.object({
  lane: z.string(),
  fromM: z.number(),
  toM: z.number(),
  departAt: z.number(),
  lieS: z.number().nonnegative(),
  purpose: z.enum(['beat', 'return', 'transfer', 'coal', 'shelter', 'away', 'winter', 'lie']),
});

export const patrolStateSchema = z.object({
  leg: legSchema,
  /** Sorties planned so far: the draw key. */
  sortie: z.number().int().nonnegative(),
  /** When she last coaled. */
  coaledAt: z.number(),
  /** A beat she's shifting base for, to run once she gets there. */
  intent: z.string().optional(),
});
export type PatrolState = z.infer<typeof patrolStateSchema>;

export const tugStateSchema = patrolStateSchema.extend({
  /** The region that chartered her (it reached tier 5). */
  region: z.string(),
  /** She's paid off and goes home at this game time. */
  until: z.number(),
});
export type TugState = z.infer<typeof tugStateSchema>;

/** The law's ships' saved state (save v7, optional: absent, she starts at Duluth). */
export const lawShipsSchema = z.object({
  morrill: patrolStateSchema,
  tug: tugStateSchema.nullable(),
});
export type LawShipsState = z.infer<typeof lawShipsSchema>;

/** What the planner asks of the world. */
export interface PatrolWorld {
  defs: LawDefs;
  lanes: PatrolLanes;
  /** The run's seed: the same run makes the same draws. */
  seed: string;
  /** Wanted tier in a region now. */
  tier(region: string): number;
  /** A gale blows at a route node (or at her position while under way). */
  gale(at: { node?: string; lane?: string; alongM?: number }): boolean;
}

const HOUR = 3600;

function lane(world: PatrolWorld, id: string): PatrolLane {
  const l = world.lanes.get(id);
  if (!l) throw new Error(`No patrol lane ${id}`);
  return l;
}

/** Hours from a [min, max] range by a 0–1 draw. */
function hoursIn([a, b]: readonly [number, number], u: number): number {
  return (a + (b - a) * u) * HOUR;
}

/** The node where a leg leaves her (its end). */
export function legEndNode(world: PatrolWorld, leg: PatrolLeg): string | undefined {
  return nodeAt(lane(world, leg.lane), leg.toM)?.id;
}

/** A leg that lies where she is for `lieS` (no passage). */
function lieLeg(at: PatrolLeg, now: number, lieS: number, purpose: LegPurpose): PatrolLeg {
  return { lane: at.lane, fromM: at.toM, toM: at.toM, departAt: now, lieS, purpose };
}

/** Out along a lane from the end at `node`: forward from `from`, or back from `to`. */
function legFrom(
  l: PatrolLane,
  node: string,
  now: number,
  lieS: number,
  purpose: LegPurpose,
): PatrolLeg | undefined {
  if (l.from.id === node)
    return { lane: l.id, fromM: 0, toM: l.lengthM, departAt: now, lieS, purpose };
  if (l.to.id === node)
    return { lane: l.id, fromM: l.lengthM, toM: 0, departAt: now, lieS, purpose };
  return undefined;
}

/** A beat's weight for the sortie draw (§5.1): Hunted regions draw her strongly. */
export function beatWeight(
  defs: LawDefs,
  regions: readonly string[],
  tier: (r: string) => number,
): number {
  const c = defs.actors.cutter;
  let w = c.baseWeight;
  for (const r of regions) w += c.pull[Math.min(tier(r), c.pull.length - 1)] ?? 0;
  return w;
}

/** The *Morrill* at the start of a run: lying at Duluth, coaled. */
export function createMorrill(defs: LawDefs, lanes: PatrolLanes, now: number): PatrolState {
  const c = defs.actors.cutter;
  const t = lanes.get(c.transfer);
  if (!t) throw new Error(`No transfer lane ${c.transfer}`);
  const atStart = t.from.id === c.coalingNode ? 0 : t.lengthM;
  return {
    leg: { lane: t.id, fromM: atStart, toM: atStart, departAt: now, lieS: 0, purpose: 'lie' },
    sortie: 0,
    coaledAt: now,
  };
}

/** The base end of a beat lane (its `from`, which the data puts at a base). */
function beatBase(world: PatrolWorld, laneId: string): string {
  return lane(world, laneId).from.id;
}

/**
 * The *Morrill*'s next leg, from where the last one left her at `now`. Pure apart from
 * the state it updates (the sortie count, coaling, the intent).
 */
export function planMorrill(world: PatrolWorld, s: PatrolState, now: number): PatrolLeg {
  const c = world.defs.actors.cutter;
  const here = legEndNode(world, s.leg);
  const draw = (what: string): number => hash01(`${world.seed}:morrill:${s.sortie}:${what}`);
  const transfer = lane(world, c.transfer);

  // Off the end of a beat (a station, the lower lakes, a port that isn't a base): back to base.
  if (!here || !c.bases.includes(here)) {
    const l = lane(world, s.leg.lane);
    const back = s.leg.toM >= s.leg.fromM ? 0 : l.lengthM;
    if (world.gale(here ? { node: here } : { lane: l.id, alongM: s.leg.toM }) && here) {
      return lieLeg(s.leg, now, c.shelterH * HOUR, 'shelter');
    }
    return {
      lane: l.id,
      fromM: s.leg.toM,
      toM: back,
      departAt: now,
      lieS: hoursIn(c.baseH, draw('base')),
      purpose: 'return',
    };
  }

  // Winter quarters at the coaling port while the ice is in.
  if (c.winterMonths.includes(monthAt(now))) {
    if (here !== c.coalingNode) {
      return legFrom(transfer, here, now, SECONDS_PER_GAME_DAY, 'winter') as PatrolLeg;
    }
    return lieLeg(s.leg, now, SECONDS_PER_GAME_DAY, 'winter');
  }

  // She doesn't put out in a gale.
  if (world.gale({ node: here })) return lieLeg(s.leg, now, c.shelterH * HOUR, 'shelter');

  // Coaling.
  if (now - s.coaledAt >= c.coalEveryH * HOUR) {
    if (here === c.coalingNode) {
      s.coaledAt = now + c.coalingH * HOUR;
      return lieLeg(s.leg, now, c.coalingH * HOUR, 'coal');
    }
    return legFrom(transfer, here, now, 0, 'coal') as PatrolLeg;
  }

  s.sortie++;
  // Shifting base for a beat she chose at the other one.
  let beat = s.intent;
  s.intent = undefined;
  if (!beat) beat = chooseBeat(world, here, draw('beat'));
  if (beat === c.away.lane) {
    const days = c.away.days[0] + (c.away.days[1] - c.away.days[0]) * draw('away');
    const away = legFrom(lane(world, beat), here, now, days * SECONDS_PER_GAME_DAY, 'away');
    if (away) return away;
  }
  const base = beatBase(world, beat);
  if (base !== here) {
    s.intent = beat;
    return legFrom(transfer, here, now, HOUR, 'transfer') as PatrolLeg;
  }
  return legFrom(
    lane(world, beat),
    here,
    now,
    hoursIn(c.stationH, draw('station')),
    'beat',
  ) as PatrolLeg;
}

/** Every option for her next sortie with its weight (for the planner and the dev overlay). */
export function sortieWeights(
  world: PatrolWorld,
  here: string,
): { lane: string; weight: number }[] {
  const c = world.defs.actors.cutter;
  const out = c.beats.map((b) => ({
    lane: b.lane,
    weight: beatWeight(world.defs, b.regions, world.tier),
  }));
  const top = Math.max(0, ...world.defs.regions.map((r) => world.tier(r.id)));
  const awayLane = world.lanes.get(c.away.lane);
  const awayFromHere = awayLane && (awayLane.from.id === here || awayLane.to.id === here);
  if (top <= c.away.maxTier && awayFromHere) out.push({ lane: c.away.lane, weight: c.away.weight });
  return out;
}

function chooseBeat(world: PatrolWorld, here: string, u: number): string {
  const options = sortieWeights(world, here);
  // A beat from this base is a little likelier than one that needs the passage first.
  for (const o of options) {
    const l = world.lanes.get(o.lane);
    if (l && l.from.id === here) o.weight *= 1.25;
  }
  const total = options.reduce((n, o) => n + o.weight, 0);
  let x = u * total;
  for (const o of options) {
    x -= o.weight;
    if (x < 0) return o.lane;
  }
  return (options[options.length - 1] as { lane: string }).lane;
}

/**
 * Turns her for shelter if a gale has come on while she's out (§5.1): under way, or lying
 * at a station, she makes for the nearer port at her lane's ends. Returns true when the
 * leg changed.
 */
export function shelterIfGale(
  world: PatrolWorld,
  s: { leg: PatrolLeg },
  speedKn: number,
  now: number,
  shelterH: number,
): boolean {
  const leg = s.leg;
  if (leg.purpose === 'shelter') return false;
  const l = lane(world, leg.lane);
  const along = legAlongM(leg, speedKn, now);
  const moving = legUnderWay(leg, speedKn, now);
  const lying = !moving && now >= legArriveAt(leg, speedKn);
  const node = nodeAt(l, along);
  if (!moving && (!lying || node?.role === 'port')) return false;
  if (!world.gale({ lane: l.id, alongM: along })) return false;
  const ends = [
    { m: 0, node: l.from },
    { m: l.lengthM, node: l.to },
  ].filter((e) => e.node.role === 'port');
  if (ends.length === 0) return false;
  ends.sort((a, b) => Math.abs(a.m - along) - Math.abs(b.m - along));
  const to = (ends[0] as { m: number }).m;
  s.leg = {
    lane: l.id,
    fromM: along,
    toM: to,
    departAt: now,
    lieS: shelterH * HOUR,
    purpose: 'shelter',
  };
  return true;
}

/** Advances a ship's plan to `now`: every leg done since gets its successor. */
export function advancePatrol(
  world: PatrolWorld,
  s: PatrolState,
  speedKn: number,
  now: number,
  plan: (s: PatrolState, at: number) => PatrolLeg,
): void {
  // Legs are hours long, so a few iterations cover any gap; the cap guards a bad config.
  for (let i = 0; i < 64; i++) {
    const done = legDoneAt(s.leg, speedKn);
    if (done > now) return;
    s.leg = plan(s, done);
  }
}

// -------------------------------------------------------------------------------------
// The chartered tug (§5.1: tier 5)

/** The beats that cover a region, and the base they share (the tug works from one port). */
export function tugBeats(
  world: PatrolWorld,
  region: string,
): { base: string; lanes: string[] } | undefined {
  const beats = world.defs.actors.cutter.beats.filter((b) => b.regions.includes(region));
  const first = beats[0];
  if (!first) return undefined;
  const base = beatBase(world, first.lane);
  return { base, lanes: beats.filter((b) => beatBase(world, b.lane) === base).map((b) => b.lane) };
}

/** A tug chartered in `region` at `now`, lying at the port her beats run from. */
export function charterTug(world: PatrolWorld, region: string, now: number): TugState | undefined {
  const t = world.defs.actors.tug;
  const beats = tugBeats(world, region);
  const first = beats && lane(world, beats.lanes[0] as string);
  if (!beats || !first) return undefined;
  return {
    leg: { lane: first.id, fromM: 0, toM: 0, departAt: now, lieS: 0, purpose: 'lie' },
    sortie: 0,
    coaledAt: now,
    region,
    until: now + t.days * SECONDS_PER_GAME_DAY,
  };
}

/** The tug's next leg: out one of her region's beats and back, over and over. */
export function planTug(world: PatrolWorld, s: TugState, now: number): PatrolLeg {
  const t = world.defs.actors.tug;
  const draw = (what: string): number =>
    hash01(`${world.seed}:tug:${s.region}:${s.sortie}:${what}`);
  const l = lane(world, s.leg.lane);
  const atBase = nodeAt(l, s.leg.toM)?.id === l.from.id;
  if (!atBase) {
    return {
      lane: l.id,
      fromM: s.leg.toM,
      toM: 0,
      departAt: now,
      lieS: hoursIn(t.baseH, draw('base')),
      purpose: 'return',
    };
  }
  if (world.gale({ node: l.from.id }))
    return lieLeg(s.leg, now, world.defs.actors.cutter.shelterH * HOUR, 'shelter');
  s.sortie++;
  const beats = tugBeats(world, s.region)?.lanes ?? [l.id];
  const pick = lane(world, beats[Math.floor(draw('beat') * beats.length) % beats.length] as string);
  return {
    lane: pick.id,
    fromM: 0,
    toM: pick.lengthM,
    departAt: now,
    lieS: hoursIn(t.stationH, draw('station')),
    purpose: 'beat',
  };
}
