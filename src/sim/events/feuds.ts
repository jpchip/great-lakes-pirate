import { z } from 'zod';
import feudsJson from '../../../data/feuds.json';
import {
  FEUD_METHODS,
  feudsFileSchema,
  type FeudDef,
  type FeudMethod,
  type FeudsFile,
} from '../../../data/schemas/feuds';
import { SECONDS_PER_GAME_DAY } from '../../core/time';

/**
 * Feud chains (plan 12 §5.2; plan 11 §18.4 piece D): the Hollister feud. Pure functions on
 * the saved `feuds` record; `gameplay/feuds.ts` feeds them sales, crimes and the clock, and
 * fires each beat's event.
 *
 * The stages:
 * - **quiet:** sales of the feud's goods at its ports are counted; enough of them inside
 *   `notice.withinDays` and the company notices (the `undercut` beat).
 * - **undercut:** its buyers pay you `undercut` of the price there. After `refuse.afterSales`
 *   more sales there, or `refuse.afterDays`, the `refuses` beat.
 * - **refused:** its buyers there turn your goods away, and its agents offer you no
 *   contracts. Every `terms` days it writes offering terms; taking them ends it **yielded**.
 * - From undercut on, **pressure** builds by three methods: crimes at its sheds, crimes
 *   against its boats (named to you or not: the company knows who it's quarrelling with),
 *   and out-trading it (the goods sold at other ports, and Standing won in its own town).
 *   At `rewardAt` from crime it posts a reward with the law (once); at `gives` in all it
 *   gives in, by the method that did most, and the feud ends **won**.
 * - **won:** it pays you `ends.won.factor` at its ports. **yielded:** `ends.yielded.factor`.
 */

export const FEUDS: FeudsFile = feudsFileSchema.parse(feudsJson);

export function feudDef(id: string, defs: FeudsFile = FEUDS): FeudDef | undefined {
  return defs.find((f) => f.id === id);
}

/** The feud a company is party to. */
export function feudOfCompany(company: string, defs: FeudsFile = FEUDS): FeudDef | undefined {
  return defs.find((f) => f.company === company);
}

export const FEUD_STAGES = ['quiet', 'undercut', 'refused', 'won', 'yielded'] as const;
export type FeudStage = (typeof FEUD_STAGES)[number];

export const feudStateSchema = z.object({
  stage: z.enum(FEUD_STAGES),
  /** When the stage began. */
  since: z.number(),
  /** Quiet: when you sold the goods at its ports lately (the notice window). */
  sales: z.array(z.number()),
  /** Undercut: sales at its price so far. */
  undercutSales: z.number().int().nonnegative(),
  /** Pressure by method: points for crimes, CU sold elsewhere for trade. */
  sheds: z.number().nonnegative(),
  tugs: z.number().nonnegative(),
  tradeCu: z.number().nonnegative(),
  /** Your Standing at its first port when it began. */
  standingAtStart: z.number(),
  /** The reward with the law is posted. */
  reward: z.boolean(),
  /** When it last offered terms. */
  termsAt: z.number().optional(),
  /** How it ended: the method that made it give. */
  method: z.enum(FEUD_METHODS).optional(),
});
export type FeudState = z.infer<typeof feudStateSchema>;

/** The save's `feuds` (plan 12 §10 `feuds {hollister: stage}`), by feud id. */
export const feudsStateSchema = z.record(z.string(), feudStateSchema);
export type FeudsState = z.infer<typeof feudsStateSchema>;

export function createFeud(now: number): FeudState {
  return {
    stage: 'quiet',
    since: now,
    sales: [],
    undercutSales: 0,
    sheds: 0,
    tugs: 0,
    tradeCu: 0,
    standingAtStart: 0,
    reward: false,
  };
}

export function feudOpen(f: FeudState | undefined): boolean {
  return f?.stage === 'undercut' || f?.stage === 'refused';
}

/** A beat that fires an event: the stage it moves to (or the reward, which doesn't). */
export type FeudBeat =
  | { kind: 'undercut' }
  | { kind: 'refuses' }
  | { kind: 'reward' }
  | { kind: 'terms' }
  | { kind: 'gives'; method: FeudMethod };

const DAY = SECONDS_PER_GAME_DAY;

/**
 * You sold `qty` of a good at a port: counted toward the notice at its ports, toward the
 * refusal while undercut, and toward out-trading at any other port while it's on.
 */
export function noteSale(
  def: FeudDef,
  f: FeudState,
  port: string,
  good: string,
  qty: number,
  now: number,
): void {
  if (!def.goods.includes(good) || qty <= 0) return;
  const theirs = def.ports.includes(port);
  if (f.stage === 'quiet' && theirs) {
    f.sales = [...f.sales, now].filter((t) => now - t <= def.notice.withinDays * DAY);
  } else if (f.stage === 'undercut' && theirs) {
    f.undercutSales += 1;
  } else if (feudOpen(f) && !theirs) {
    f.tradeCu += qty;
  }
}

/** A crime against the company: pressure by its method. */
export function noteCrime(def: FeudDef, f: FeudState, crime: string): FeudMethod | undefined {
  if (!feudOpen(f)) return undefined;
  const c = def.pressure.crimes[crime];
  if (!c) return undefined;
  f[c.method] += c.points;
  return c.method;
}

export interface FeudPressure {
  sheds: number;
  tugs: number;
  trade: number;
  total: number;
}

/** The pressure on the company now, by method; `standing` is yours at its first port now. */
export function pressureOf(def: FeudDef, f: FeudState, standing: number): FeudPressure {
  const won = Math.max(0, standing - f.standingAtStart);
  const trade = f.tradeCu * def.pressure.perCuElsewhere + won * def.pressure.perStanding;
  return { sheds: f.sheds, tugs: f.tugs, trade, total: f.sheds + f.tugs + trade };
}

/** The method that did most (ties to the sheds, then the tugs). */
export function leadingMethod(p: FeudPressure): FeudMethod {
  let best: FeudMethod = 'sheds';
  for (const m of FEUD_METHODS) if (p[m] > p[best]) best = m;
  return best;
}

/**
 * What's due now: the next beat, or none. The caller fires its event and then calls
 * `enterBeat` (a beat taken back, as an event that can't fire, leaves the state alone).
 */
export function dueBeat(
  def: FeudDef,
  f: FeudState,
  now: number,
  standing: number,
): FeudBeat | undefined {
  switch (f.stage) {
    case 'quiet':
      return f.sales.filter((t) => now - t <= def.notice.withinDays * DAY).length >=
        def.notice.sales
        ? { kind: 'undercut' }
        : undefined;
    case 'undercut':
    case 'refused': {
      const p = pressureOf(def, f, standing);
      if (p.total >= def.pressure.gives) return { kind: 'gives', method: leadingMethod(p) };
      if (!f.reward && p.sheds + p.tugs >= def.pressure.rewardAt) return { kind: 'reward' };
      if (f.stage === 'undercut') {
        const long = now - f.since >= def.refuse.afterDays * DAY;
        return f.undercutSales >= def.refuse.afterSales || long ? { kind: 'refuses' } : undefined;
      }
      const wait = f.termsAt === undefined ? def.terms.afterDays * DAY : def.terms.againDays * DAY;
      const from = f.termsAt ?? f.since;
      return now - from >= wait ? { kind: 'terms' } : undefined;
    }
    default:
      return undefined;
  }
}

/** Moves the feud on by a beat whose event has fired. */
export function enterBeat(f: FeudState, beat: FeudBeat, now: number, standing: number): void {
  switch (beat.kind) {
    case 'undercut':
      f.stage = 'undercut';
      f.since = now;
      f.sales = [];
      f.standingAtStart = standing;
      return;
    case 'refuses':
      f.stage = 'refused';
      f.since = now;
      return;
    case 'reward':
      f.reward = true;
      return;
    case 'terms':
      f.termsAt = now;
      return;
    case 'gives':
      f.stage = 'won';
      f.since = now;
      f.method = beat.method;
      return;
  }
}

/** You took the company's terms. */
export function yieldFeud(f: FeudState, now: number): void {
  if (!feudOpen(f)) return;
  f.stage = 'yielded';
  f.since = now;
}

/**
 * What the company's buyers pay you for a good at a port, as a share of the market's price:
 * 0 when they turn it away, 1 where the feud doesn't reach.
 */
export function sellFactor(
  def: FeudDef,
  f: FeudState | undefined,
  port: string,
  good: string,
): number {
  if (!f || !def.ports.includes(port) || !def.goods.includes(good)) return 1;
  switch (f.stage) {
    case 'undercut':
      return def.undercut;
    case 'refused':
      return 0;
    case 'won':
      return def.ends.won.factor;
    case 'yielded':
      return def.ends.yielded.factor;
    default:
      return 1;
  }
}

/** The company's agents won't deal with you: it's refusing your goods. */
export function shunsYou(f: FeudState | undefined): boolean {
  return f?.stage === 'refused';
}
