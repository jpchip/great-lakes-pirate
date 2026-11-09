import type { Identification, Witness } from './witness';
import { IDENTIFICATION_ORDER } from './witness';

/**
 * Crimes at sea and who tells of them (plan 07 §7.2, plan 06 §2; Phase 6 piece F). Plain
 * functions the game layer (`gameplay/sea-law.ts`) uses to turn piece A's gunfire and
 * piece D's boarding into the law's crimes:
 *
 * - **The victim's crew** is a witness who reports late: when their ship makes port after
 *   you let them go, slower if you disabled her, after the row ashore if you set them
 *   adrift, and never if they went down with her. They had you alongside, so they know your
 *   ship's profile, and your face once you're Known.
 * - **Anyone else in sight** reports in their own time, as Phase 5's witnesses do: the
 *   detection meters' watchers, plus the ships the looting screen counts in sight.
 * - **Gunfire** is heard well beyond sight: the watchers in earshot look for you at once.
 */

/** The crimes a ship at sea can be the victim of, in the order an encounter commits them. */
export const SEA_CRIMES = [
  'crime.firing_on_ship',
  'crime.killing',
  'crime.piracy',
  'crime.sinking',
] as const;
export type SeaCrime = (typeof SEA_CRIMES)[number];

/** The stronger of two identifications. */
export function strongerIdent(a: Identification, b: Identification): Identification {
  return IDENTIFICATION_ORDER.indexOf(a) >= IDENTIFICATION_ORDER.indexOf(b) ? a : b;
}

/**
 * How well a crew can name you. Boarded, they had you on their deck: your ship, and your
 * face once your Fame reaches `knowsFromTier`. Only fired on, they know you as well as
 * their lookout made you out (her detection meter), or not at all.
 */
export function crewIdentification(opts: {
  boarded: boolean;
  /** Her lookout's meter on you, if she had one. */
  watcher: Identification | undefined;
  fameTier: number;
  knowsFromTier: number;
}): Identification {
  if (opts.boarded) return opts.fameTier >= opts.knowsFromTier ? 'person' : 'ship';
  return opts.watcher ?? 'unknown';
}

/**
 * A ship in sight while you work her prize (piece D's count): close by day she reads
 * your profile; further off, "a schooner"; at night or in fog, only something going on,
 * unless she's close aboard.
 */
export function sightingIdentification(
  distanceM: number,
  dark01: number,
  identifyM: number,
): Identification {
  if (dark01 >= 0.5) return distanceM <= identifyM / 2 ? 'schooner' : 'unknown';
  return distanceM <= identifyM ? 'ship' : 'schooner';
}

/** The victim's crew as a witness. */
export function crewWitness(
  shipId: string,
  name: string,
  identification: Identification,
  zoneId?: string,
): Witness {
  return {
    id: `crew.${shipId}`,
    kind: 'crew',
    name: `the crew of the ${name}`,
    identification,
    ...(zoneId ? { zoneId } : {}),
  };
}

/**
 * Witnesses at the moment of a crime, less the ships it was done to (their crew's report
 * is the pending one) and anyone not able to name anything. One per witness id, the best
 * identification kept.
 */
export function thirdParties(seen: readonly Witness[], victims: ReadonlySet<string>): Witness[] {
  const best = new Map<string, Witness>();
  for (const w of seen) {
    if (victims.has(w.id)) continue;
    const had = best.get(w.id);
    if (!had || strongerIdent(w.identification, had.identification) !== had.identification) {
      best.set(w.id, w);
    }
  }
  return [...best.values()];
}

/**
 * When the crew of a ship you left afloat reports: `reportInS` from now (piece D's
 * aftermath preview: her passage, slower disabled, the row ashore), or never.
 */
export function crewReportAt(now: number, reportInS: number | undefined): number | undefined {
  return reportInS === undefined ? undefined : now + reportInS;
}
