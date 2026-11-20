import endingsJson from '../../../data/endings.json';
import {
  endingsFileSchema,
  type EndingPage,
  type EndingsFile,
  type RetirementDef,
} from '../../../data/schemas/endings';

/**
 * The voluntary endings (plan 12 §4.2; Phase 9 piece B): when a run may Retire or Turn
 * Lawman, and which letter choice takes which. Both are offered by a letter at the harbor
 * masters' (`gameplay/endings.ts` fires it); the pages are built by `run-end.ts`.
 *
 * - **Retire:** cash in your hideouts' strongboxes at least `retire.wealthCents` (the same
 *   measure as the wealth Ambitions), and no region above
 *   `retire.maxWantedTier` (tier 3, Hunted, and up rules it out). Three retirements.
 * - **Turn Lawman:** Fame tier at least `lawman.minFameTier`, every region at
 *   `lawman.maxWantedTier` or below, and Standing of `standing.min` in `standing.ports` ports.
 */

export const ENDINGS: EndingsFile = endingsFileSchema.parse(endingsJson);

export type EndingKind = 'retire' | 'lawman';

/** What the offers read of the run. */
export interface EndingWorld {
  /** Cash aboard and in every hideout's strongbox, cents. */
  wealthCents: number;
  fameTier: number;
  /** Each region's Wanted tier. */
  wantedTiers: readonly number[];
  /** Standing by port. */
  standing: Readonly<Record<string, number>>;
}

export interface Eligibility {
  ok: boolean;
  /** What stands in the way, in a line each. */
  missing: string[];
}

export function retireEligibility(world: EndingWorld, defs: EndingsFile = ENDINGS): Eligibility {
  const r = defs.retire;
  const missing: string[] = [];
  if (world.wealthCents < r.wealthCents) missing.push('wealth');
  if (world.wantedTiers.some((t) => t > r.maxWantedTier)) missing.push('wanted');
  return { ok: missing.length === 0, missing };
}

export function lawmanEligibility(world: EndingWorld, defs: EndingsFile = ENDINGS): Eligibility {
  const l = defs.lawman;
  const missing: string[] = [];
  if (world.fameTier < l.minFameTier) missing.push('fame');
  if (world.wantedTiers.some((t) => t > l.maxWantedTier)) missing.push('wanted');
  const good = Object.values(world.standing).filter((s) => s >= l.standing.min).length;
  if (good < l.standing.ports) missing.push('standing');
  return { ok: missing.length === 0, missing };
}

export function eligibility(
  kind: EndingKind,
  world: EndingWorld,
  defs: EndingsFile = ENDINGS,
): Eligibility {
  return kind === 'retire' ? retireEligibility(world, defs) : lawmanEligibility(world, defs);
}

export function offerEvent(kind: EndingKind, defs: EndingsFile = ENDINGS): string {
  return kind === 'retire' ? defs.retire.event : defs.lawman.event;
}

/** The ending a letter's choice takes, or undefined (not yet, declined, another letter). */
export function endingForChoice(
  event: string,
  choice: string,
  defs: EndingsFile = ENDINGS,
): { kind: 'retired'; retirement: RetirementDef } | { kind: 'lawman' } | undefined {
  if (event === defs.retire.event) {
    const retirement = defs.retire.retirements.find((r) => r.choice === choice);
    return retirement ? { kind: 'retired', retirement } : undefined;
  }
  if (event === defs.lawman.event && choice === defs.lawman.choice) return { kind: 'lawman' };
  return undefined;
}

export function retirementDef(
  id: string | undefined,
  defs: EndingsFile = ENDINGS,
): RetirementDef | undefined {
  return defs.retire.retirements.find((r) => r.id === id);
}

/** An ending's page and the paper that prints it. */
export function endingPage(
  cause: 'retired' | 'lawman',
  retirement: string | undefined,
  defs: EndingsFile = ENDINGS,
): { page: EndingPage; paper: 'duluth' | 'bayfield' | 'fame' } | undefined {
  if (cause === 'lawman') return { page: defs.lawman.page, paper: defs.lawman.paper };
  const r = retirementDef(retirement, defs) ?? defs.retire.retirements[0];
  return r ? { page: r.page, paper: r.paper } : undefined;
}
