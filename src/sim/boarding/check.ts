import boardingJson from '../../../data/boarding.json';
import { boardingRulesSchema, type BoardingRules } from '../../../data/schemas/boarding';
import type { Rng } from '../../core/rng';

/**
 * The boarding check (plan 07 §6; Phase 6 piece D): a resolution, not action combat. Your
 * strength (the hands you take over the rail, their arms, your Fame and a boarding perk,
 * surprise in the dark) against her defense (her able hands, their arms, her nerve). From
 * the ratio come the odds of Intimidate and of Fight, and the chance a lost Fight kills
 * you, all shown before you commit. Pure: the running game rolls with its own rng.
 */

let cached: BoardingRules | undefined;

/** The game's boarding rules from `data/boarding.json`. */
export function gameBoarding(): BoardingRules {
  cached ??= boardingRulesSchema.parse(boardingJson);
  return cached;
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** Why you can't board her now (§6.1), or undefined when you can. */
export type BoardRefusal =
  /** Not alongside: too far off. */
  | 'notAlongside'
  /** Alongside, but moving too fast against her. */
  | 'tooFast'
  /** The T1 solo rule (decided): only a ship that has already struck. */
  | 'soloResisting'
  /** Nothing to take: she's been stripped, or is going down. */
  | 'stripped'
  | 'sinking'
  /** The law's ship, or one that isn't a prize. */
  | 'notATarget';

export const BOARD_REFUSALS: Readonly<Record<BoardRefusal, string>> = {
  notAlongside: 'Come alongside her to board',
  tooFast: 'Match her speed to grapple (under 2 kn)',
  soloResisting: "You can't take a resisting crew single-handed",
  stripped: 'You have already stripped her',
  sinking: 'She is going down: stand clear',
  notATarget: 'Not a ship you can board',
};

/**
 * Whether the player can grapple: hulls within `gapM` (the closest points of their keel
 * lines, less half each beam) and under `relKn` against her.
 */
export function alongside(
  rules: BoardingRules,
  gapM: number,
  relKn: number,
): BoardRefusal | undefined {
  if (gapM > rules.alongside.gapM) return 'notAlongside';
  if (relKn > rules.alongside.relKn) return 'tooFast';
  return undefined;
}

/** What you bring over her rail. */
export interface BoardingSide {
  /** The player's ship tier (1 is you alone). */
  tier: number;
  /** Swivels that can be trained on her deck, and cannon run out. */
  swivels: number;
  cannon: number;
  fameTier: number;
  /** Background perks the captain has. */
  perks: readonly string[];
  /** 0 broad day and clear, 1 a dark night or thick fog. */
  dark01: number;
}

/** What she has to meet you with. */
export interface BoardedShip {
  /** Hands aboard alive (killed taken off), and of them wounded. */
  crew: number;
  wounded: number;
  armed: boolean;
  /** Her morale meter, 0–100 (piece C). */
  morale: number;
  /** She has struck her colors: the surrender is only confirmed. */
  struck: boolean;
}

export interface BoardingOdds {
  strength: number;
  defense: number;
  ratio: number;
  /** Chance each option succeeds, 0–1 (Intimidate is 1 against a ship that has struck). */
  intimidate: number;
  fight: number;
  /** Chance a lost Fight kills you; 0 unless the odds are bad. */
  death: number;
  /** The named parts of your strength, for the panel. */
  parts: { label: string; value: number }[];
}

export function crewOf(rules: BoardingRules, tier: number): number {
  return rules.crewByTier[String(tier)] ?? 1;
}

/** Your strength and her defense, and the odds of each option (§6.2). */
export function boardingOdds(
  rules: BoardingRules,
  you: BoardingSide,
  her: BoardedShip,
): BoardingOdds {
  const a = rules.arms;
  const hands = crewOf(rules, you.tier);
  const arms = a.smallArms + a.swivel * you.swivels + a.cannon * you.cannon;
  const parts: { label: string; value: number }[] = [
    { label: hands === 1 ? 'You alone, armed' : `${hands} of you, armed`, value: hands * arms },
  ];
  let perk = 0;
  for (const p of you.perks) perk += rules.perkStrength[p] ?? 0;
  if (perk) parts.push({ label: 'Your quarterdeck voice', value: perk });
  const fame = rules.fameStrength * Math.max(0, you.fameTier);
  if (fame) parts.push({ label: 'Your name', value: fame });
  const surprise = you.dark01 >= rules.darkAt ? rules.surpriseStrength : 0;
  if (surprise) parts.push({ label: 'Surprise in the dark', value: surprise });
  const strength = parts.reduce((s, p) => s + p.value, 0);

  const able = Math.max(0, her.crew - her.wounded) + her.wounded * a.woundedShare;
  const moraleFactor = clamp(her.morale / rules.morale.neutral, rules.morale.min, rules.morale.max);
  const defense = able * (her.armed ? a.armedCrewArms : a.crewArms) * moraleFactor;
  const ratio = defense > 0 ? strength / defense : 99;

  const i = rules.intimidate;
  const intimidate = her.struck
    ? 1
    : clamp(
        ratio * i.ratioWeight +
          you.fameTier * i.fameWeight +
          (rules.morale.neutral - her.morale) * i.moraleWeight,
        i.min,
        i.max,
      );
  const f = rules.fight;
  const fight = clamp(ratio / (ratio + f.bias), f.min, f.max);
  const d = rules.death;
  const death = fight < d.badOdds ? Math.min(d.max, (d.badOdds - fight) * d.perShortfall) : 0;
  return { strength, defense, ratio, intimidate, fight, death, parts };
}

/** Whether the T1 solo rule (or anything else) keeps you off her before the panel opens. */
export function boardRefusal(
  tier: number,
  her: { struck: boolean; robbed: boolean; sinking: boolean; target: boolean },
): BoardRefusal | undefined {
  if (!her.target) return 'notATarget';
  if (her.sinking) return 'sinking';
  if (her.robbed) return 'stripped';
  if (tier <= 1 && !her.struck) return 'soloResisting';
  return undefined;
}

export type BoardingOption = 'intimidate' | 'fight' | 'withdraw';

export type BoardingOutcome =
  | { option: 'intimidate'; ok: true }
  | { option: 'intimidate'; ok: false }
  | {
      option: 'fight';
      ok: true;
      theirKilled: number;
      theirWounded: number;
      oursWounded: number;
    }
  | {
      option: 'fight';
      ok: false;
      /** Points off your hull. */
      hullDamage: number;
      killed: boolean;
      oursWounded: number;
    }
  | { option: 'withdraw'; ok: true };

/**
 * Rolls one option. A won fight leaves casualties on both sides scaled by her defense; a
 * lost one is repelled with damage to your hull, and at bad odds may kill you.
 */
export function resolveBoarding(
  rules: BoardingRules,
  option: BoardingOption,
  odds: BoardingOdds,
  her: BoardedShip,
  you: { tier: number; hull: number; hullMax: number; herHullMax: number },
  rng: Rng,
): BoardingOutcome {
  if (option === 'withdraw') return { option, ok: true };
  if (option === 'intimidate') return { option, ok: rng.next() < odds.intimidate };
  const c = rules.casualties;
  const ours =
    you.tier <= 1
      ? 0
      : Math.min(crewOf(rules, you.tier) - 1, Math.round(odds.defense * c.oursPerDefense));
  if (rng.next() < odds.fight) {
    const able = Math.max(0, her.crew - her.wounded);
    const hit = Math.min(
      able,
      Math.max(1, Math.round(able * rng.range(c.theirShare[0], c.theirShare[1]))),
    );
    const killed = Math.round(hit * c.theirKilled);
    return { option, ok: true, theirKilled: killed, theirWounded: hit - killed, oursWounded: ours };
  }
  const r = rules.repelled;
  const want = you.herHullMax * rng.range(r.hullShare[0], r.hullShare[1]);
  const floor = you.hullMax * r.floorShare;
  const hullDamage = Math.max(0, Math.min(want, you.hull - floor));
  const killed = odds.death > 0 && rng.next() < odds.death;
  return { option, ok: false, hullDamage, killed, oursWounded: ours };
}
