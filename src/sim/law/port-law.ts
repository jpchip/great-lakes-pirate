import { Rng } from '../../core/rng';
import { dayAndHour } from '../../core/time';
import type { HarborMasterRules } from '../../../data/schemas/law';
import { tierDef, topWantedTier, wantedTier, type LawDefs } from './defs';
import { heatIn, regionWanted, setHeat, type LawEvent } from './law';
import type { LawState } from './state';

/**
 * Port law (plan 06 §3.3, §5.2; Phase 5 piece E): what the harbor master will take to
 * clear your name, the check of the hold on docking at tier 2+, the posters, and how
 * likely a receiver or the smuggler is to turn you in. Plain state in, results out; the
 * game layer (`gameplay/port-law.ts`) moves the purse and raises the events.
 *
 * - **Fines** (tiers 1–2) clear a region's heat outright, at `fineCentsPerHeat`.
 * - **Bribes** (tiers 3–4) take it down to the bottom of the tier below, at
 *   `bribeCentsPerHeat` for the heat taken off. Not at tier 5: too notorious.
 * - The Saloon Keeper pays `saloonKeeperDiscount` less for either (plan 12 §2.2).
 */

export type HarborDeal = 'fine' | 'bribe';

/** Why the harbor master won't deal, in a word. */
export type HarborRefusal = 'clean' | 'tooNotorious' | 'noMoney' | 'notOffered';

export interface HarborQuote {
  kind: HarborDeal;
  cents: number;
  /** The region's heat after paying, and its tier. */
  toHeat: number;
  toTier: number;
}

export interface HarborTerms {
  region: string;
  tier: number;
  heat: number;
  /** What's on offer at this tier; undefined when nothing is (clean, or tier 5). */
  quote: HarborQuote | undefined;
  /** Why nothing's on offer. */
  refusal: 'clean' | 'tooNotorious' | undefined;
}

export function harborRules(defs: LawDefs): HarborMasterRules {
  return defs.actors.harborMaster;
}

function byTier(list: readonly number[], tier: number): number {
  return list[Math.max(0, Math.min(list.length - 1, tier))] ?? 0;
}

/** What the harbor master asks to clear (fine) or cool (bribe) a region's heat. */
export function harborTerms(
  defs: LawDefs,
  law: LawState,
  region: string,
  saloonKeeper = false,
): HarborTerms {
  const rules = harborRules(defs);
  const heat = heatIn(law, region);
  const tier = wantedTier(defs, heat);
  const base = { region, tier, heat };
  if (tier === 0) return { ...base, quote: undefined, refusal: 'clean' };
  const discount = saloonKeeper ? 1 - rules.saloonKeeperDiscount : 1;
  if (rules.fineTiers.includes(tier)) {
    return {
      ...base,
      quote: {
        kind: 'fine',
        cents: Math.max(100, Math.round(heat * rules.fineCentsPerHeat * discount)),
        toHeat: 0,
        toTier: 0,
      },
      refusal: undefined,
    };
  }
  if (rules.bribeTiers.includes(tier)) {
    const toHeat = tierDef(defs, tier - 1).minHeat;
    return {
      ...base,
      quote: {
        kind: 'bribe',
        cents: Math.max(100, Math.round((heat - toHeat) * rules.bribeCentsPerHeat * discount)),
        toHeat,
        toTier: tier - 1,
      },
      refusal: undefined,
    };
  }
  return { ...base, quote: undefined, refusal: 'tooNotorious' };
}

export type HarborPayResult =
  | { ok: true; quote: HarborQuote; heatFrom: number; events: LawEvent[] }
  | { ok: false; reason: HarborRefusal };

/**
 * Pays the harbor master: the fine or the bribe the terms offer, from the purse. `kind`
 * must match what's on offer (the screen's button), so a stale screen can't pay a bribe
 * the tier no longer takes.
 */
export function payHarborMaster(
  defs: LawDefs,
  law: LawState,
  purse: { purse: number },
  region: string,
  kind: HarborDeal,
  saloonKeeper = false,
): HarborPayResult {
  const terms = harborTerms(defs, law, region, saloonKeeper);
  if (terms.refusal) return { ok: false, reason: terms.refusal };
  const quote = terms.quote;
  if (!quote || quote.kind !== kind) return { ok: false, reason: 'notOffered' };
  if (purse.purse < quote.cents) return { ok: false, reason: 'noMoney' };
  purse.purse -= quote.cents;
  const heatFrom = terms.heat;
  const events = setHeat(defs, law, region, quote.toHeat);
  // Paid off: the alert the unidentified reports raised goes with it.
  if (quote.toHeat === 0) regionWanted(law, region).alert = 0;
  return { ok: true, quote, heatFrom, events };
}

/** The share of the merchants' detection odds a harbor master's search finds, by tier. */
export function searchFactor(defs: LawDefs, tier: number): number {
  const rules = harborRules(defs);
  return tier >= rules.searchFromTier ? byTier(rules.searchByTier, tier) : 0;
}

/** Whether docking in a region at this tier means a check of the hold (§3.2 tier 2). */
export function holdChecked(defs: LawDefs, tier: number): boolean {
  return searchFactor(defs, tier) > 0;
}

/**
 * The roll for one lot at one port's search, 0–1: the run, the port, the game day and the
 * lot, so docking again the same day finds the same things (nothing new to find).
 */
export function searchRoll(
  runSeed: string,
  port: string,
  gameSeconds: number,
  lotKey: string,
): number {
  const day = dayAndHour(Math.max(0, gameSeconds)).day;
  return Rng.fromSeed(`${runSeed}|search|${port}|${day}|${lotKey}`).next();
}

/** How likely a receiver or the smuggler is to turn you in at this tier, 0–1. */
export function informChance(defs: LawDefs, tier: number): number {
  const rules = harborRules(defs);
  return tier >= rules.informFromTier ? byTier(rules.informByTier, tier) : 0;
}

/** The informant's roll: same port (or anchorage), same week, same answer. */
export function informRoll(runSeed: string, where: string, week: number, key: string): number {
  return Rng.fromSeed(`${runSeed}|inform|${where}|${week}|${key}`).next();
}

/** A WANTED poster on the harbor master's board (plan 06 §3.2 tier 2+). */
export interface Poster {
  tier: number;
  /** "WANTED", "WANTED: REWARD", "WANTED: DEAD OR ALIVE". */
  headline: string;
  /** Whom it's after: the ship (most of the heat is on her profile) or the captain. */
  subject: 'ship' | 'person';
  /** The reward named, cents; 0 below `bountyFromTier`. */
  rewardCents: number;
}

/** The poster for a region's heat, or undefined below `posterFromTier`. */
export function posterFor(defs: LawDefs, law: LawState, region: string): Poster | undefined {
  const rules = harborRules(defs);
  const w = law.wanted[region];
  const heat = w?.heat ?? 0;
  const tier = wantedTier(defs, heat);
  if (tier < rules.posterFromTier) return undefined;
  const top = tier >= topWantedTier(defs);
  const rewardCents =
    tier >= rules.bountyFromTier ? Math.round((heat * rules.bountyCentsPerHeat) / 500) * 500 : 0;
  return {
    tier,
    headline: top ? 'WANTED: DEAD OR ALIVE' : rewardCents > 0 ? 'WANTED: REWARD' : 'WANTED',
    subject: w && w.shipHeat >= heat / 2 ? 'ship' : 'person',
    rewardCents,
  };
}
