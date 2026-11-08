import type { BoardingRules } from '../../../data/schemas/boarding';
import type { Rng } from '../../core/rng';

/**
 * What to do with a taken ship and her crew (plan 07 §7.2; Phase 6 piece D). Each choice
 * says what becomes of her, who dies, and how long before her crew can tell the law: let
 * go, they report at her next port; disabled, they limp there; set adrift with the ship
 * scuttled, they row ashore (and the weather may drown some, a chance shown first); sunk
 * with all hands, nobody reports unless someone else saw. Piece F reads the delay.
 */

export type AftermathChoice = 'letGo' | 'disable' | 'adrift' | 'sinkWithCrew';

export const AFTERMATH_CHOICES: readonly AftermathChoice[] = [
  'letGo',
  'disable',
  'adrift',
  'sinkWithCrew',
];

export interface AftermathConditions {
  /** Wind where she lies, knots. */
  windKn: number;
  /** The calendar month, 0 January. */
  month: number;
  /** 0 broad day, 1 a dark night or thick fog. */
  dark01: number;
  /** Her passage to her next port, game seconds, if known. */
  voyageS?: number | undefined;
}

export interface AftermathPreview {
  choice: AftermathChoice;
  /** Her crew can tell the law this many game seconds from now; undefined: nobody will. */
  reportInS: number | undefined;
  /** The chance the boat loses hands (set adrift only). */
  deathChance: number;
  /** Everyone aboard dies (sunk with the crew). */
  allHands: boolean;
  /** She goes to the bottom. */
  sinks: boolean;
}

const HOUR = 3600;

/** The boat's weather check (§7.2): 0 in fair conditions, more in a blow, cold or dark. */
export function adriftDeathChance(rules: BoardingRules, c: AftermathConditions): number {
  const a = rules.aftermath.adrift;
  let p = 0;
  if (c.windKn >= a.windKn) p += a.windBase + (c.windKn - a.windKn) * a.perKnOver;
  const cold = a.coldMonths.includes(c.month);
  if (cold) p += a.cold;
  // The dark alone is no danger in fair weather; it makes a blow or cold water worse.
  if (p > 0 && c.dark01 >= 0.5) p += a.dark;
  return Math.min(a.max, p);
}

export function previewAftermath(
  rules: BoardingRules,
  choice: AftermathChoice,
  c: AftermathConditions,
): AftermathPreview {
  const r = rules.aftermath;
  const voyage = c.voyageS ?? r.defaultVoyageHours * HOUR;
  switch (choice) {
    case 'letGo':
      return { choice, reportInS: voyage, deathChance: 0, allHands: false, sinks: false };
    case 'disable':
      return {
        choice,
        reportInS: voyage * r.limpFactor,
        deathChance: 0,
        allHands: false,
        sinks: false,
      };
    case 'adrift':
      return {
        choice,
        reportInS: Math.max(voyage, r.rowHours * HOUR) + r.rowHours * HOUR,
        deathChance: adriftDeathChance(rules, c),
        allHands: false,
        sinks: true,
      };
    case 'sinkWithCrew':
      return { choice, reportInS: undefined, deathChance: 1, allHands: true, sinks: true };
  }
}

export interface AftermathResult extends AftermathPreview {
  /** Hands who died of it. */
  killed: number;
  /** Hands who live to tell it. */
  survivors: number;
}

/** Carries out a choice for a crew of `crew` living hands. */
export function resolveAftermath(
  rules: BoardingRules,
  choice: AftermathChoice,
  c: AftermathConditions,
  crew: number,
  rng: Rng,
): AftermathResult {
  const p = previewAftermath(rules, choice, c);
  let killed = 0;
  if (p.allHands) killed = crew;
  else if (p.deathChance > 0 && crew > 0 && rng.next() < p.deathChance) {
    const [lo, hi] = rules.aftermath.adrift.lostShare;
    killed = Math.min(crew, Math.max(1, Math.round(crew * rng.range(lo, hi))));
  }
  const survivors = crew - killed;
  return { ...p, reportInS: survivors > 0 ? p.reportInS : undefined, killed, survivors };
}
