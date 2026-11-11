import jailJson from '../../../data/jail.json';
import { jailFileSchema, type JailFile } from '../../../data/schemas/jail';
import { SECONDS_PER_GAME_DAY } from '../../core/time';
import { Rng } from '../../core/rng';
import { siteDef } from '../hideouts/stash';
import type { WorldState } from '../world-state';
import { setHeat } from './law';
import { tierDef, wantedTier, type LawDefs } from './defs';
import type { LawEvent } from './law';
import type { JailState } from './state';

/**
 * Capture and jail (plan 06 §8, plan 12 §8.1; Phase 5 piece D), as plain state in and
 * out. Taken at sea below tier 5, the captain goes to the lockup: cargo and cash on hand
 * are confiscated, the ship is impounded, and the sentence (weeks, one game day each)
 * grows with the region's heat. Bail comes from a hideout's strongbox by "send word" (the
 * messenger's fee and a delay); serving the sentence brings the region's heat down to
 * tier 1. The ship comes back for the impound fee, from the strongbox, or worked off on the
 * coal dock a few days more. At tier 5, capture means the rope: the jailbreak that could
 * save you is Phase 7's, so for now the run ends.
 */

export type Jailed = NonNullable<JailState>;

let cached: JailFile | undefined;

export function gameJail(): JailFile {
  cached ??= jailFileSchema.parse(jailJson);
  return cached;
}

/** `subdued`: taken on foot by a constable, watchman or marshal (Phase 7 piece D). */
export type CaptureHow = 'surrender' | 'boarded' | 'subdued';

export interface CaptureInput {
  /** The region you were taken in. */
  region: string;
  by: string;
  how: CaptureHow;
}

/** What capture in a region comes to (plan 06 §8.2), before anything is taken. */
export type CaptureOutcome =
  | {
      kind: 'jail';
      tier: number;
      heat: number;
      sentenceWeeks: number;
      bailCents: number;
      impoundCents: number;
    }
  | { kind: 'execution'; tier: number; heat: number };

const lerp = (lo: number, hi: number, t: number): number => lo + (hi - lo) * t;

/** How far heat is through its tier, 0–1 (the top tier counts to twice its floor). */
function throughTier(defs: LawDefs, heat: number, tier: number): number {
  const lo = tierDef(defs, tier).minHeat;
  const next = defs.wanted.tiers[tier + 1]?.minHeat ?? lo * 2;
  if (next <= lo) return 0;
  return Math.max(0, Math.min(1, (heat - lo) / (next - lo)));
}

export function captureOutcome(defs: LawDefs, jail: JailFile, heat: number): CaptureOutcome {
  const tier = wantedTier(defs, heat);
  if (tier >= jail.executionFromTier) return { kind: 'execution', tier, heat };
  const rows = jail.sentences;
  const row = rows.find((r) => r.tier === tier) ?? rows[rows.length - 1];
  if (!row) throw new Error('jail.json has no sentences');
  const t = throughTier(defs, heat, tier);
  const sentenceWeeks = Math.round(lerp(row.weeks[0], row.weeks[1], t));
  const bailCents = Math.round(lerp(row.bailCents[0], row.bailCents[1], t) / 100) * 100;
  const impoundCents = jail.impound.baseCents + jail.impound.perWeekCents * sentenceWeeks;
  return { kind: 'jail', tier, heat, sentenceWeeks, bailCents, impoundCents };
}

/**
 * Takes the captain (plan 12 §8.1): cargo and cash on hand confiscated, the voyage over,
 * and the jail state set. Hideouts are untouched. Returns the jail state.
 */
export function imprison(
  defs: LawDefs,
  jail: JailFile,
  state: WorldState,
  input: CaptureInput,
  now: number,
): Jailed {
  const heat = state.wanted[input.region]?.heat ?? 0;
  const outcome = captureOutcome(defs, jail, heat);
  const cargo = state.player.cargo.map((s) => ({ good: s.good, qty: s.qty }));
  const cashCents = state.player.purse;
  state.player.cargo = [];
  state.player.purse = 0;
  state.voyage = null;
  const execution = outcome.kind === 'execution';
  const weeks = outcome.kind === 'jail' ? outcome.sentenceWeeks : 0;
  const jailed: Jailed = {
    region: input.region,
    port: jail.lockup.port,
    since: now,
    releaseAt: now + weeks * SECONDS_PER_GAME_DAY,
    by: input.by,
    how: input.how,
    tier: outcome.tier,
    heat,
    sentenceWeeks: weeks,
    bailCents: outcome.kind === 'jail' ? outcome.bailCents : 0,
    impoundCents: outcome.kind === 'jail' ? outcome.impoundCents : 0,
    execution,
    confiscated: { cargo, cashCents },
    workOffDays: 0,
  };
  state.jail = jailed;
  return jailed;
}

/** A hideout with a strongbox, and the cash in it. */
export interface Strongbox {
  id: string;
  cash: number;
}

export function strongboxes(state: WorldState): Strongbox[] {
  return Object.entries(state.hideouts ?? {})
    .filter(([, h]) => siteDef(h.siteId)?.storage.strongbox)
    .map(([id, h]) => ({ id, cash: h.storage.cash }));
}

/** What sending word for bail costs from a strongbox: bail, the ship and the messenger. */
export function wordCost(jail: JailFile, jailed: Jailed): number {
  return jailed.bailCents + jailed.impoundCents + jail.sendWord.feeCents;
}

export type WordRefusal = 'execution' | 'sent' | 'noStrongbox' | 'short';

export function wordRefusal(
  jail: JailFile,
  state: WorldState,
  hideout: string | undefined,
): WordRefusal | undefined {
  const jailed = state.jail;
  if (!jailed || jailed.execution) return 'execution';
  if (jailed.word) return 'sent';
  const box = strongboxes(state).find((b) => (hideout ? b.id === hideout : true));
  if (!box) return 'noStrongbox';
  const richest = hideout ? box : strongboxes(state).sort((a, b) => b.cash - a.cash)[0];
  if (!richest || richest.cash < wordCost(jail, jailed)) return 'short';
  return undefined;
}

/**
 * Sends word for bail (plan 12 §8.1): the messenger takes bail, the impound fee and a
 * fee from the strongbox, and you walk out when the money comes. The delay is seeded by the
 * run and the day you were taken, so a reload doesn't change it. Bail lets you out early
 * but doesn't clear your name: the region's heat stays where it was.
 */
export function sendWord(
  jail: JailFile,
  state: WorldState,
  hideout: string,
  seed: string,
  now: number,
): WordRefusal | undefined {
  const why = wordRefusal(jail, state, hideout);
  const jailed = state.jail;
  const h = state.hideouts?.[hideout];
  if (why || !jailed || !h) return why ?? 'noStrongbox';
  const cost = wordCost(jail, jailed);
  h.storage.cash -= cost;
  const [lo, hi] = jail.sendWord.delayHours;
  const hours = hi > lo ? Rng.fromSeed(`${seed}:word:${jailed.since}`).range(lo, hi) : lo;
  const arrivesAt = now + hours * 3600;
  jailed.word = { hideout, sentAt: now, arrivesAt, paidCents: cost };
  jailed.releaseAt = Math.min(jailed.releaseAt, arrivesAt);
  return undefined;
}

/**
 * Settles the impound fee before the time is served (no bail sent): from the richest
 * strongbox if it can, else the days to work it off are added to the sentence. Returns
 * where the money came from, if it was paid.
 */
export function settleImpound(jail: JailFile, state: WorldState): string | undefined {
  const jailed = state.jail;
  if (!jailed || jailed.execution || jailed.word || jailed.workOffDays > 0) return undefined;
  const box = strongboxes(state)
    .filter((b) => b.cash >= jailed.impoundCents)
    .sort((a, b) => b.cash - a.cash)[0];
  const h = box && state.hideouts?.[box.id];
  if (box && h) {
    h.storage.cash -= jailed.impoundCents;
    return box.id;
  }
  const days = Math.ceil(jailed.impoundCents / jail.impound.workOffCentsPerDay);
  jailed.workOffDays = days;
  jailed.releaseAt += days * SECONDS_PER_GAME_DAY;
  return undefined;
}

export interface Release {
  /** How you got out. */
  how: 'served' | 'bail';
  /** Game seconds inside. */
  insideS: number;
  workOffDays: number;
  /** The region's heat before and after. */
  region: string;
  heatBefore: number;
  heatAfter: number;
  events: LawEvent[];
}

/**
 * Lets the captain out (plan 06 §8.2). Time served or bail brings the region's heat down
 * to the release tier (tier 1), and no lower than it already was (Jared, 2026-11-08).
 */
export function release(defs: LawDefs, jail: JailFile, state: WorldState, now: number): Release {
  const jailed = state.jail;
  if (!jailed) throw new Error('Not in jail');
  if (jailed.execution) throw new Error('No release from the rope');
  const how = jailed.word ? 'bail' : 'served';
  const heatBefore = state.wanted[jailed.region]?.heat ?? 0;
  // Serving the sentence or paying bail both bring the region down to the release tier.
  const cap = tierDef(defs, jail.releaseTier).minHeat;
  const events: LawEvent[] = heatBefore > cap ? setHeat(defs, state, jailed.region, cap) : [];
  state.jail = null;
  return {
    how,
    insideS: now - jailed.since,
    workOffDays: jailed.workOffDays,
    region: jailed.region,
    heatBefore,
    heatAfter: state.wanted[jailed.region]?.heat ?? 0,
    events,
  };
}
