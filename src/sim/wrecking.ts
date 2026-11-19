import { z } from 'zod';
import wreckingJson from '../../data/wrecking.json';
import {
  wreckingFileSchema,
  type WreckingFile,
  type WreckingMark,
  type WreckingRules,
} from '../../data/schemas/wrecking';
import { METERS_PER_NAUTICAL_MILE, type Chart } from '../core/coords';
import { Rng } from '../core/rng';
import { SECONDS_PER_GAME_DAY } from '../core/time';

/**
 * Wrecking, "moon cussing" (plan 06 §6.2, plan 11 §18.4 piece I). Pure, no three.js.
 *
 * - **The rig.** A false-light rig from the lockers is set at a mark (a headland or shoal
 *   edge beside a lane, `wrecking.json`) after dark; it burns until dawn or its kerosene is
 *   gone. A real light doused at its lantern (piece H) is a trap of its own at the marks by
 *   it, weaker, and only in weather.
 * - **Ships steer by the lights they know.** Every ship on a lane past a mark is judged
 *   once a trap as she passes: fooled or not, by the light used, the dark (sun and moon),
 *   the weather at the mark and her captain. The roll is seeded by the trap and the ship,
 *   so a reload judges her the same way.
 * - **Stranded or broken.** A fooled ship strands on the mark's shoal and lies there to be
 *   boarded as a struck ship until her owners' tug pulls her off; in a gale she may break
 *   up instead, a wreck with most of her hands. Either way some may drown.
 * - **Who saw it.** The keeper of the mark's light, if he's at his post and the night lets
 *   him, sees a light where none should be; the survivors saw it too. Without them nobody
 *   knows it was anything but the lake.
 * - **Pattern detection.** Strandings near one light within a few weeks open an
 *   investigation there: heat in its region and the cutter sent, witnesses or not.
 *
 * The world (traffic, sky, weather, keepers) comes in through `WreckingWorld`, so the tests
 * drive it with a seeded storm and the game with the real sim.
 */

export const WRECKING: WreckingFile = wreckingFileSchema.parse(wreckingJson);
export const WRECK_RULES: WreckingRules = WRECKING.rules;
export const MARKS: readonly WreckingMark[] = WRECKING.marks;

export function markById(id: string): WreckingMark | undefined {
  return MARKS.find((m) => m.id === id);
}

const HOUR = 3600;
/** The sim judges passing ships every this many game seconds (the world tick). */
export const WRECK_STEP_S = 600;
/** A long time skip is caught up over at most this much (a passage takes well under). */
const MAX_CATCH_UP_S = 2 * SECONDS_PER_GAME_DAY;
/** Judged ships are forgotten after this long (a trap lasts a night). */
const JUDGED_KEEP_S = 0.75 * SECONDS_PER_GAME_DAY;
/** Strandings near a light remembered for pattern detection. */
const SUSPICIOUS_KEEP = 24;

const cargoSchema = z.array(z.object({ good: z.string(), qty: z.number().int().positive() }));

/** A ship on a shoal: struck where she lies, to be boarded until she's pulled off. */
export const strandingSchema = z.object({
  id: z.string(),
  shipId: z.string(),
  name: z.string(),
  classId: z.string(),
  owner: z.string().optional(),
  mark: z.string(),
  at: z.number(),
  /** Pulled off then (her owners' tug), and off to be repaired. */
  until: z.number(),
  /** What fooled her: your rig, the light you doused, or both. */
  by: z.enum(['rig', 'doused', 'both']),
  crew: z.number().int().nonnegative(),
  drowned: z.number().int().nonnegative(),
  cargo: cargoSchema,
  /** Boarded and looted: the hold's been through. */
  boarded: z.boolean().optional(),
});
export type Stranding = z.infer<typeof strandingSchema>;

export const wreckingStateSchema = z.object({
  /** The judged span's end, game seconds. */
  steppedTo: z.number(),
  nextId: z.number().int().positive(),
  rigs: z.array(
    z.object({ id: z.string(), mark: z.string(), setAt: z.number(), until: z.number() }),
  ),
  /** Ships judged at a trap this night (`trap|ship`), so each is judged once. */
  judged: z.array(z.object({ key: z.string(), at: z.number() })),
  strandings: z.array(strandingSchema),
  /** Strandings and break-ups near each light, for pattern detection. */
  suspicious: z.array(z.object({ light: z.string(), mark: z.string(), at: z.number() })),
  investigations: z.array(
    z.object({ light: z.string(), region: z.string(), at: z.number(), until: z.number() }),
  ),
  /** Ships you've put on a shoal, stranded or broken, all run (piece B's nickname reads it). */
  count: z.number().int().nonnegative(),
});
export type WreckingState = z.infer<typeof wreckingStateSchema>;

export function freshWrecking(now: number): WreckingState {
  return {
    steppedTo: now,
    nextId: 1,
    rigs: [],
    judged: [],
    strandings: [],
    suspicious: [],
    investigations: [],
    count: 0,
  };
}

/** A ship on her lane at a moment, as the traffic has her. */
export interface PassingShip {
  id: string;
  name: string;
  classId: string;
  owner?: string | undefined;
  /** Chart position (the route graph's projection), meters. */
  pos: Chart;
  underWay: boolean;
}

/** What the sky and weather are at a mark. */
export interface MarkConditions {
  /** The sun's elevation, degrees. */
  sunDeg: number;
  /** The moon's light, 0 (none: new, set, or clouded) – 1 (full, high, clear). */
  moon01: number;
  visM: number;
  windKn: number;
}

export interface WreckingWorld {
  seed: string;
  /** The traffic at a moment: ships off their timetables (lost) left out. */
  ships(t: number): readonly PassingShip[];
  /** A lon/lat point in the ships' chart frame. */
  toChart(p: { lat: number; lon: number }): Chart;
  conditions(mark: WreckingMark, t: number): MarkConditions;
  /** When the light's lamp was put out, if it's dark at `t`. */
  dousedSince(light: string, t: number): number | undefined;
  /** A keeper is at his post at the light (living, not tied up, bribed or ashore). */
  keeperWatching(light: string, t: number): boolean;
  /** The Wanted region the light stands in. */
  regionOfLight(light: string): string;
  crewOf(classId: string): number;
  /** Her hold at a moment. */
  cargoOf(shipId: string, t: number): { good: string; qty: number }[];
  /** Your ship lies near the mark (within `nearM`), and is seen there with her lamps lit. */
  playerNear?(mark: WreckingMark, t: number): 'seen' | 'near' | undefined;
}

export type WreckWitness = 'keeper' | 'crew';

export type WreckingOutcome =
  | {
      type: 'stranded' | 'broken';
      stranding: Stranding;
      region: string;
      /** Who saw the false light, and how well they saw who hung it. */
      witnesses: { kind: WreckWitness; ident: 'unknown' | 'schooner' }[];
      /** The wind at the mark, for the papers. */
      windKn: number;
    }
  | { type: 'investigation'; light: string; region: string; until: number }
  | { type: 'rigOut'; rig: string; mark: string };

// ---------------------------------------------------------------------------------
// The odds

export type TrapKind = 'falseLight' | 'doused' | 'both';

/** The weather's factor at a mark: thick or a gale 1, a fresh breeze `fresh`, else clear. */
export function weatherFactor(c: Pick<MarkConditions, 'visM' | 'windKn'>, rules = WRECK_RULES) {
  const w = rules.weather;
  if (c.visM < w.thickVisM || c.windKn >= w.galeKn) return 1;
  if (c.windKn >= w.freshKn) {
    return w.fresh + ((1 - w.fresh) * (c.windKn - w.freshKn)) / (w.galeKn - w.freshKn);
  }
  return w.clear;
}

/** The dark's factor: none by day; at night 1 on a moonless night, `moonFactor` at full. */
export function darkFactor(c: Pick<MarkConditions, 'sunDeg' | 'moon01'>, rules = WRECK_RULES) {
  if (c.sunDeg > rules.nightSunDeg) return 0;
  return 1 - (1 - rules.moonFactor) * Math.min(1, Math.max(0, c.moon01));
}

/** A captain's factor from 0 (the sharpest) to 1 (the sloppiest). */
export function captainFactor(captain01: number, rules = WRECK_RULES): number {
  const [lo, hi] = rules.captain;
  return lo + (hi - lo) * Math.min(1, Math.max(0, captain01));
}

/** A ship's captain, fixed for the run: how readily he takes a light on trust. */
export function captainOf(seed: string, shipId: string): number {
  return Rng.fromSeed(`${seed}|captain|${shipId}`).next();
}

/** The chance a ship passing the mark is fooled and turns in for the light. */
export function foolChance(
  mark: Pick<WreckingMark, 'danger'>,
  kind: TrapKind,
  c: MarkConditions,
  captain01: number,
  rules = WRECK_RULES,
): number {
  const dark = darkFactor(c, rules);
  if (dark <= 0) return 0;
  const wx = weatherFactor(c, rules);
  if (kind === 'doused' && wx < rules.dousedNeedsWeather) return 0;
  const base =
    kind === 'doused'
      ? rules.chance.doused
      : rules.chance.falseLight * (kind === 'both' ? rules.bothFactor : 1);
  const p = base * mark.danger * dark * wx * captainFactor(captain01, rules);
  return Math.min(0.95, Math.max(0, p));
}

/** The chance a fooled ship breaks up on the shoal rather than strands, by the wind. */
export function breakUpChance(windKn: number, rules = WRECK_RULES): number {
  const { fromKn, atGaleChance } = rules.breakUp;
  if (windKn < fromKn) return 0;
  const k = Math.min(1, (windKn - fromKn) / Math.max(1, rules.weather.galeKn - fromKn));
  return atGaleChance * k;
}

// ---------------------------------------------------------------------------------
// The rig

export type RigRefusal = 'noRig' | 'notAtMark' | 'daylight' | 'alreadySet';

export const RIG_REFUSALS: Record<RigRefusal, string> = {
  noRig: 'There is no false-light rig in the lockers. The workbench at a hideout makes one.',
  notAtMark: 'No mark here: a false light only fools a ship whose course runs past it.',
  daylight: 'A light by day fools nobody. Wait for dark.',
  alreadySet: 'Your light already burns here.',
};

/** The rigs burning at a moment. */
export function rigsLit(state: WreckingState | undefined, t: number) {
  return (state?.rigs ?? []).filter((r) => t >= r.setAt && t < r.until);
}

/**
 * Sets a rig at a mark: it burns `rigHours` or until the sun's up, whichever comes first.
 * `sunDeg` gives the sun's elevation at a time. The caller takes the rig from the lockers.
 */
export function setRig(
  state: WreckingState,
  mark: WreckingMark,
  now: number,
  sunDeg: (t: number) => number,
  rules = WRECK_RULES,
): { ok: true; until: number; id: string } | { ok: false; reason: RigRefusal } {
  if (sunDeg(now) > rules.nightSunDeg) return { ok: false, reason: 'daylight' };
  if (rigsLit(state, now).some((r) => r.mark === mark.id)) {
    return { ok: false, reason: 'alreadySet' };
  }
  let until = now + rules.rigHours * HOUR;
  for (let t = now + WRECK_STEP_S; t < until; t += WRECK_STEP_S) {
    if (sunDeg(t) > rules.nightSunDeg) {
      until = t;
      break;
    }
  }
  const id = `rig-${state.nextId++}`;
  state.rigs.push({ id, mark: mark.id, setAt: now, until });
  return { ok: true, until, id };
}

/** The mark within reach of a zone point, given each mark's rig spot in zone meters. */
export function markInReach(
  at: { x: number; z: number },
  rigSpots: ReadonlyMap<string, { x: number; z: number }>,
  rules = WRECK_RULES,
): WreckingMark | undefined {
  let best: { m: WreckingMark; d: number } | undefined;
  for (const m of MARKS) {
    const s = rigSpots.get(m.id);
    if (!s) continue;
    const d = Math.hypot(s.x - at.x, s.z - at.z);
    if (d <= rules.setRangeM && (!best || d < best.d)) best = { m, d };
  }
  return best?.m;
}

// ---------------------------------------------------------------------------------
// The night's work

interface Trap {
  key: string;
  mark: WreckingMark;
  kind: TrapKind;
}

function trapsAt(state: WreckingState, world: WreckingWorld, t: number): Trap[] {
  const out: Trap[] = [];
  const lit = rigsLit(state, t);
  for (const mark of MARKS) {
    const rig = lit.find((r) => r.mark === mark.id);
    const doused = world.dousedSince(mark.light, t);
    if (!rig && doused === undefined) continue;
    const kind: TrapKind = rig && doused !== undefined ? 'both' : rig ? 'falseLight' : 'doused';
    const key = rig ? rig.id : `douse:${mark.light}:${Math.round(doused ?? 0)}`;
    out.push({ key, mark, kind });
  }
  return out;
}

function between(rng: Rng, [lo, hi]: readonly [number, number]): number {
  return lo + (hi - lo) * rng.next();
}

/**
 * Judges the ships passing the marks from `state.steppedTo` to `to`, in world-tick steps:
 * each one at a lit trap is judged once, and a fooled one strands or breaks up. Puts out
 * rigs burned down, lets stranded ships be pulled off, and opens investigations.
 */
export function stepWrecking(
  state: WreckingState,
  world: WreckingWorld,
  to: number,
  rules = WRECK_RULES,
): WreckingOutcome[] {
  const out: WreckingOutcome[] = [];
  let t = Math.max(state.steppedTo, to - MAX_CATCH_UP_S);
  const passM = rules.passNm * METERS_PER_NAUTICAL_MILE;
  const shoals = new Map(MARKS.map((m) => [m.id, world.toChart(m.shoal)]));
  const judged = new Set(state.judged.map((j) => j.key));
  while (t + WRECK_STEP_S <= to) {
    t += WRECK_STEP_S;
    const traps = trapsAt(state, world, t);
    if (traps.length === 0) continue;
    const ships = world.ships(t);
    for (const trap of traps) {
      const shoal = shoals.get(trap.mark.id) as Chart;
      for (const ship of ships) {
        if (!ship.underWay) continue;
        if (Math.hypot(ship.pos.x - shoal.x, ship.pos.y - shoal.y) > passM) continue;
        const key = `${trap.key}|${ship.id}`;
        if (judged.has(key)) continue;
        judged.add(key);
        state.judged.push({ key, at: t });
        const o = judge(state, world, trap, ship, t, rules);
        if (o) out.push(...o);
      }
    }
  }
  state.steppedTo = Math.max(state.steppedTo, to);
  // Rigs burned down.
  for (const r of state.rigs.filter((x) => x.until <= to)) {
    out.push({ type: 'rigOut', rig: r.id, mark: r.mark });
  }
  state.rigs = state.rigs.filter((x) => x.until > to);
  state.judged = state.judged.filter((j) => to - j.at < JUDGED_KEEP_S);
  state.strandings = state.strandings.filter((s) => s.until > to);
  state.investigations = state.investigations.filter((i) => i.until > to);
  return out;
}

function judge(
  state: WreckingState,
  world: WreckingWorld,
  trap: Trap,
  ship: PassingShip,
  t: number,
  rules: WreckingRules,
): WreckingOutcome[] | undefined {
  const c = world.conditions(trap.mark, t);
  const p = foolChance(trap.mark, trap.kind, c, captainOf(world.seed, ship.id), rules);
  const rng = Rng.fromSeed(`${world.seed}|wreck|${trap.key}|${ship.id}`);
  if (p <= 0 || rng.next() >= p) return undefined;

  const broken = rng.next() < breakUpChance(c.windKn, rules);
  const crew = Math.max(0, Math.round(world.crewOf(ship.classId)));
  const share = between(rng, broken ? rules.drowned.broken : rules.drowned.stranded);
  const drowned = Math.min(crew, Math.round(crew * share));
  const cargo = world.cargoOf(ship.id, t).filter((l) => l.qty > 0);
  const stranding: Stranding = {
    id: `stranding-${state.nextId++}`,
    shipId: ship.id,
    name: ship.name,
    classId: ship.classId,
    ...(ship.owner ? { owner: ship.owner } : {}),
    mark: trap.mark.id,
    at: t,
    until: t + (broken ? 0 : rules.strandedDays * SECONDS_PER_GAME_DAY),
    by: trap.kind === 'falseLight' ? 'rig' : trap.kind,
    crew,
    drowned,
    cargo: cargo.map((l) => ({ good: l.good, qty: Math.round(l.qty) })).filter((l) => l.qty > 0),
  };
  if (!broken) state.strandings.push(stranding);
  state.count++;

  // Who saw a light where none should be.
  const region = world.regionOfLight(trap.mark.light);
  const near = world.playerNear?.(trap.mark, t);
  const ident = near === 'seen' ? 'schooner' : 'unknown';
  const witnesses: { kind: WreckWitness; ident: 'unknown' | 'schooner' }[] = [];
  if (trap.kind !== 'doused' && world.keeperWatching(trap.mark.light, t)) {
    const thick = c.visM < rules.weather.thickVisM;
    if (rng.next() < rules.keeper.chance * (thick ? 0.4 : 1)) {
      witnesses.push({ kind: 'keeper', ident });
    }
  }
  if (crew - drowned > 0 && trap.kind !== 'doused') witnesses.push({ kind: 'crew', ident });

  const out: WreckingOutcome[] = [
    { type: broken ? 'broken' : 'stranded', stranding, region, witnesses, windKn: c.windKn },
  ];

  // Pattern detection.
  state.suspicious.push({ light: trap.mark.light, mark: trap.mark.id, at: t });
  if (state.suspicious.length > SUSPICIOUS_KEEP) state.suspicious.shift();
  const inv = rules.investigation;
  const recent = state.suspicious.filter(
    (s) => s.light === trap.mark.light && t - s.at <= inv.withinDays * SECONDS_PER_GAME_DAY,
  );
  const open = state.investigations.some((i) => i.light === trap.mark.light && i.until > t);
  if (recent.length >= inv.wrecks && !open) {
    const until = t + inv.days * SECONDS_PER_GAME_DAY;
    state.investigations.push({ light: trap.mark.light, region, at: t, until });
    out.push({ type: 'investigation', light: trap.mark.light, region, until });
  }
  return out;
}

// ---------------------------------------------------------------------------------
// What the rest of the game asks

/** Ships lying stranded now, to be shown on their shoals. */
export function strandedNow(state: WreckingState | undefined, t: number): Stranding[] {
  return (state?.strandings ?? []).filter((s) => t >= s.at && t < s.until);
}

export function strandingOf(
  state: WreckingState | undefined,
  shipId: string,
  t: number,
): Stranding | undefined {
  return strandedNow(state, t).find((s) => s.shipId === shipId);
}

/** An investigation is open in this region: the cutter's been sent. */
export function investigated(state: WreckingState | undefined, region: string, t: number): boolean {
  return (state?.investigations ?? []).some((i) => i.region === region && t < i.until);
}

/**
 * The moon-cussing night (plan 12 §5.2): the moon dark, foul weather at a mark, and a laden
 * ship due past it after dark within `withinHours`. The first such passage, or undefined.
 */
export function moonCussingNight(
  world: WreckingWorld,
  now: number,
  moonIllumination01: number,
  rules = WRECK_RULES,
): { mark: WreckingMark; shipId: string; name: string; at: number } | undefined {
  if (moonIllumination01 > rules.moonCussing.maxIllumination) return undefined;
  const foul = MARKS.filter(
    (m) => weatherFactor(world.conditions(m, now), rules) >= rules.weather.fresh,
  );
  if (foul.length === 0) return undefined;
  const passM = rules.passNm * METERS_PER_NAUTICAL_MILE;
  const shoals = foul.map((m) => ({ m, p: world.toChart(m.shoal) }));
  const end = now + rules.moonCussing.withinHours * HOUR;
  for (let t = now; t <= end; t += 2 * WRECK_STEP_S) {
    const night = shoals.filter(({ m }) => world.conditions(m, t).sunDeg <= rules.nightSunDeg);
    if (night.length === 0) continue;
    for (const ship of world.ships(t)) {
      if (!ship.underWay) continue;
      for (const { m, p } of night) {
        if (Math.hypot(ship.pos.x - p.x, ship.pos.y - p.y) > passM) continue;
        if (world.cargoOf(ship.id, t).length === 0) continue;
        return { mark: m, shipId: ship.id, name: ship.name, at: t };
      }
    }
  }
  return undefined;
}
