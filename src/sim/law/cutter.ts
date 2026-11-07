import type { Awareness } from './perception';

/**
 * The *Morrill* at close quarters (plan 06 §5.1, §8.1; Phase 5 piece C): what her captain
 * does about the player once they're on the same water, in a zone or an arena. Plain state
 * and plain inputs, so it unit-tests; `gameplay/law-at-sea.ts` feeds it her lookout's
 * detection meter (piece B) and the Wanted tier (piece A) and carries out what it says.
 *
 * - **Never at tier 0.** A clean captain sails unbothered, seen or not.
 * - **Inspection at tier 1.** Spotted in a Suspicious region, she closes, hails "heave to
 *   for inspection", and once the player lies stopped alongside she searches the hold
 *   (`inspect`). What she finds is the caller's to confiscate; at tier 2+ after the find,
 *   she arrests (another heave-to is a surrender).
 * - **Pursuit at tier 2+** of a ship she knows (identified; at tier 3+ spotted is enough),
 *   or of one that runs from an inspection: hail, a warning shot, then disabling fire on
 *   the rigging only. She never sinks you: Phase 5 gives you no gun to fire on her with.
 * - **Surrender** is heaving to under her guns; a ship whose rigging is shot away and
 *   that she comes alongside is **boarded**. Either is `capture` (piece D takes over).
 * - **The shallows.** She draws too much to follow into shoal water: she stands off,
 *   holds her fire, and after a while gives it up.
 * - **Line of sight.** Lose her lookout (islands, fog, night and dark running) and she
 *   searches where you were last seen, then gives up. While she has you in sight the
 *   chart is locked (`locked`).
 */

export type CutterPhase =
  | 'patrol'
  | 'closing'
  | 'hailed'
  | 'warned'
  | 'firing'
  | 'inspecting'
  | 'searching'
  | 'standingOff'
  | 'released'
  | 'captured';

export type CutterIntent = 'inspect' | 'pursue';

export interface CutterRules {
  /** She hails inside this range, zone meters. */
  hailRangeM: number;
  /** Below this speed the player is hove to, knots, held for `heaveToS`. */
  heaveToKn: number;
  heaveToS: number;
  /** ...within this range of her. */
  heaveToRangeM: number;
  /** Seconds after the hail before the warning shot, and after it before she fires. */
  hailGraceS: number;
  warnGraceS: number;
  /** Her bow gun's range, zone meters, and a round every `fireEveryS`. */
  gunRangeM: number;
  fireEveryS: number;
  /** Hit chance at point blank and at the gun's range (linear between). */
  hitNear: number;
  hitFar: number;
  /** Rigging HP a hit carries away, as a share of the class's rigging. */
  riggingPerHit: number;
  /** At or below this rigging share the ship is disabled: she can be boarded. */
  disabledRigging01: number;
  /** Her boarding party gets aboard inside this range. */
  boardRangeM: number;
  /** Alongside and stopped this long, the search is done. */
  inspectS: number;
  /** The search party comes aboard inside this range. */
  inspectRangeM: number;
  /** A ship that makes off this far while being searched has run. */
  fleeRangeM: number;
  /** Out of sight this long, she gives up the search. */
  searchS: number;
  /** In the shallows this long, she gives it up. */
  standOffS: number;
  /** After giving up or letting you go she doesn't come back for this long. */
  cooldownS: number;
}

export const CUTTER_RULES: CutterRules = {
  hailRangeM: 700,
  heaveToKn: 1.5,
  heaveToS: 4,
  heaveToRangeM: 300,
  hailGraceS: 20,
  warnGraceS: 12,
  gunRangeM: 800,
  fireEveryS: 6,
  hitNear: 0.7,
  hitFar: 0.2,
  riggingPerHit: 0.14,
  disabledRigging01: 0.2,
  boardRangeM: 45,
  inspectS: 10,
  inspectRangeM: 80,
  fleeRangeM: 200,
  searchS: 45,
  standOffS: 50,
  cooldownS: 90,
};

export interface CutterBrain {
  phase: CutterPhase;
  /** Seconds in this phase. */
  phaseS: number;
  intent: CutterIntent;
  /** Seconds the player has lain hove to near her. */
  heaveToS: number;
  /** Seconds to the next round. */
  reloadS: number;
  /** Seconds in the shallows, out of sight, or cooling off. */
  shoalS: number;
  lostS: number;
  cooldownS: number;
  inspectS: number;
  /** Where she last saw the player (for the search), zone meters. */
  lastSeen: { x: number; z: number } | undefined;
  /** She has searched this ship already on this water. */
  inspected: boolean;
  hails: number;
  shots: number;
  /** The phase she was in when she lost sight, to take up again. */
  resume: CutterPhase;
  /** The chart lock as last reported (`pursuit` actions say when it changes). */
  locked: boolean;
}

export function createCutterBrain(start?: { hunting: boolean; intent: CutterIntent }): CutterBrain {
  return {
    phase: start?.hunting ? 'closing' : 'patrol',
    phaseS: 0,
    intent: start?.intent ?? 'inspect',
    heaveToS: 0,
    reloadS: 0,
    shoalS: 0,
    lostS: 0,
    cooldownS: 0,
    inspectS: 0,
    lastSeen: undefined,
    inspected: false,
    hails: 0,
    shots: 0,
    resume: 'closing',
    locked: false,
  };
}

/** What she knows this tick. */
export interface CutterSense {
  /** Wanted tier where the player is. */
  tier: number;
  inspectsFromTier: number;
  /** The tier from which she pursues a ship she knows. */
  pursuesFromTier: number;
  /** Her lookout's awareness of the player (piece B's meter). */
  awareness: Awareness;
  /** The lookout has matched her profile. */
  identified: boolean;
  player: { x: number; z: number };
  distanceM: number;
  playerKn: number;
  /** The player is in water too shallow for her. */
  playerShoal: boolean;
  /** The player's rigging, 0–1 of the class's. */
  rigging01: number;
}

export type CutterAction =
  | { type: 'pursuit'; locked: boolean }
  | { type: 'hail'; intent: CutterIntent; arrest: boolean }
  | { type: 'warningShot' }
  | { type: 'fire'; hit: boolean; riggingShare: number }
  | { type: 'inspect' }
  | { type: 'release' }
  | { type: 'capture'; how: 'surrender' | 'boarded' }
  | { type: 'gaveUp'; why: 'lost' | 'shallows' };

/** Phases in which she's after the player (not patrolling, done, or let go). */
const ACTIVE: ReadonlySet<CutterPhase> = new Set([
  'closing',
  'hailed',
  'warned',
  'firing',
  'inspecting',
  'searching',
  'standingOff',
]);

export function cutterActive(b: CutterBrain): boolean {
  return ACTIVE.has(b.phase);
}

/** The chart is locked while she's after you and her lookout has you (plan 06 §7.1). */
export function cutterLocks(b: CutterBrain, awareness: Awareness): boolean {
  return (
    cutterActive(b) &&
    b.phase !== 'searching' &&
    (awareness === 'spotted' || awareness === 'identified')
  );
}

function seen(a: Awareness): boolean {
  return a === 'spotted' || a === 'identified';
}

function go(b: CutterBrain, phase: CutterPhase): void {
  b.phase = phase;
  b.phaseS = 0;
}

/** What she'd make of the player on sighting: an inspection, a pursuit, or nothing. */
export function intentFor(
  sense: Pick<
    CutterSense,
    'tier' | 'inspectsFromTier' | 'pursuesFromTier' | 'identified' | 'awareness'
  >,
): CutterIntent | undefined {
  if (sense.tier < sense.inspectsFromTier || !seen(sense.awareness)) return undefined;
  const known = sense.identified || sense.tier >= sense.pursuesFromTier + 1;
  return sense.tier >= sense.pursuesFromTier && known ? 'pursue' : 'inspect';
}

/** Hit chance at a range. */
export function hitChance(rules: CutterRules, distanceM: number): number {
  const t = Math.min(Math.max(distanceM / rules.gunRangeM, 0), 1);
  return rules.hitNear + (rules.hitFar - rules.hitNear) * t;
}

/**
 * One tick of her captain's judgment. `rand` is a 0–1 draw (the run's RNG in play, a
 * fixed sequence in tests). Returns what she does this tick, in order.
 */
export function stepCutter(
  b: CutterBrain,
  sense: CutterSense,
  dt: number,
  rand: () => number,
  rules: CutterRules = CUTTER_RULES,
): CutterAction[] {
  const out: CutterAction[] = [];
  b.phaseS += dt;
  if (seen(sense.awareness)) b.lastSeen = { ...sense.player };

  // A clean captain sails unbothered: below the inspection tier she has no business with you.
  if (sense.tier < sense.inspectsFromTier && b.phase !== 'captured') {
    if (cutterActive(b)) go(b, 'released');
  }

  switch (b.phase) {
    case 'patrol':
    case 'released': {
      b.cooldownS = Math.max(0, b.cooldownS - dt);
      if (b.cooldownS > 0) break;
      const intent = intentFor(sense);
      if (!intent || (intent === 'inspect' && b.inspected)) break;
      b.intent = intent;
      go(b, 'closing');
      break;
    }
    case 'captured':
      break;
    default:
      stepActive(b, sense, dt, rand, rules, out);
  }

  const locked = cutterLocks(b, sense.awareness);
  if (locked !== b.locked) {
    b.locked = locked;
    out.unshift({ type: 'pursuit', locked });
  }
  return out;
}

function stepActive(
  b: CutterBrain,
  sense: CutterSense,
  dt: number,
  rand: () => number,
  rules: CutterRules,
  out: CutterAction[],
): void {
  // Out of sight: search where she was last seen, then give it up.
  if (!seen(sense.awareness) && b.phase !== 'searching' && b.phase !== 'inspecting') {
    b.resume = b.phase === 'standingOff' ? 'closing' : b.phase;
    b.lostS = 0;
    go(b, 'searching');
  }
  if (b.phase === 'searching') {
    if (seen(sense.awareness)) {
      go(b, b.resume);
    } else {
      b.lostS += dt;
      if (b.lostS >= rules.searchS) giveUp(b, rules, out, 'lost');
      return;
    }
  }

  // Into the shallows she won't follow: stand off, hold fire, and give it up in time.
  if (sense.playerShoal && b.phase !== 'inspecting') {
    if (b.phase !== 'standingOff') {
      b.resume = b.phase;
      b.shoalS = 0;
      go(b, 'standingOff');
    }
    b.shoalS += dt;
    if (b.shoalS >= rules.standOffS) giveUp(b, rules, out, 'shallows');
    return;
  }
  if (b.phase === 'standingOff') go(b, b.resume);

  // Hove to near her: an inspection, or (in pursuit) a surrender.
  const hoveTo = sense.playerKn < rules.heaveToKn && sense.distanceM < rules.heaveToRangeM;
  b.heaveToS = hoveTo ? b.heaveToS + dt : 0;

  if (b.phase === 'inspecting') {
    if (sense.distanceM > rules.fleeRangeM && sense.playerKn > rules.heaveToKn * 2) {
      // She ran from the search party: that's a pursuit now.
      b.intent = 'pursue';
      b.inspectS = 0;
      go(b, 'hailed');
      b.hails++;
      out.push({ type: 'hail', intent: 'pursue', arrest: false });
      return;
    }
    if (sense.distanceM <= rules.inspectRangeM && sense.playerKn < rules.heaveToKn * 2) {
      b.inspectS += dt;
    }
    if (b.inspectS >= rules.inspectS) {
      b.inspected = true;
      b.inspectS = 0;
      out.push({ type: 'inspect' });
    }
    return;
  }

  if (b.heaveToS >= rules.heaveToS) {
    b.heaveToS = 0;
    if (b.intent === 'inspect') {
      go(b, 'inspecting');
    } else {
      go(b, 'captured');
      out.push({ type: 'capture', how: 'surrender' });
    }
    return;
  }

  // Disabled and alongside: boarded.
  if (
    b.intent === 'pursue' &&
    sense.distanceM < rules.boardRangeM &&
    sense.rigging01 <= rules.disabledRigging01
  ) {
    go(b, 'captured');
    out.push({ type: 'capture', how: 'boarded' });
    return;
  }

  switch (b.phase) {
    case 'closing':
      if (sense.distanceM <= rules.hailRangeM) {
        b.hails++;
        go(b, 'hailed');
        out.push({ type: 'hail', intent: b.intent, arrest: false });
      }
      break;
    case 'hailed':
      if (b.phaseS >= rules.hailGraceS && sense.distanceM <= rules.gunRangeM) {
        // Not hove to: an inspection she runs from is a pursuit now.
        b.intent = 'pursue';
        b.shots++;
        go(b, 'warned');
        out.push({ type: 'warningShot' });
      }
      break;
    case 'warned':
      if (b.phaseS >= rules.warnGraceS) {
        b.reloadS = 0;
        go(b, 'firing');
      }
      break;
    case 'firing':
      b.reloadS -= dt;
      if (b.reloadS <= 0 && sense.distanceM <= rules.gunRangeM) {
        b.reloadS = rules.fireEveryS;
        b.shots++;
        const hit = rand() < hitChance(rules, sense.distanceM);
        out.push({ type: 'fire', hit, riggingShare: hit ? rules.riggingPerHit : 0 });
      }
      break;
    default:
      break;
  }
}

function giveUp(
  b: CutterBrain,
  rules: CutterRules,
  out: CutterAction[],
  why: 'lost' | 'shallows',
): void {
  b.cooldownS = rules.cooldownS;
  b.hails = 0;
  b.shots = 0;
  go(b, 'released');
  out.push({ type: 'gaveUp', why });
}

/**
 * After her search party is back aboard: what they found decides. A find in a region
 * already Wanted (tier 2+ after it lands) is an arrest: she hails you to stand by to be
 * boarded, and staying hove to is a surrender. Otherwise she lets you go.
 */
export function afterInspection(
  b: CutterBrain,
  found: boolean,
  tierAfter: number,
  pursuesFromTier: number,
  rules: CutterRules = CUTTER_RULES,
): CutterAction[] {
  if (found && tierAfter >= pursuesFromTier) {
    b.intent = 'pursue';
    b.hails++;
    b.heaveToS = 0;
    go(b, 'hailed');
    return [{ type: 'hail', intent: 'pursue', arrest: true }];
  }
  b.cooldownS = rules.cooldownS;
  go(b, 'released');
  return [{ type: 'release' }];
}

/** How her helm should steer for what she's doing. */
export type CutterOrders =
  | { mode: 'course' }
  | { mode: 'intercept' }
  | { mode: 'alongside' }
  | { mode: 'search'; at: { x: number; z: number } }
  | { mode: 'standOff' }
  | { mode: 'stop' };

export function cutterOrders(b: CutterBrain): CutterOrders {
  switch (b.phase) {
    case 'closing':
    case 'hailed':
    case 'warned':
    case 'firing':
      return { mode: 'intercept' };
    case 'inspecting':
      return { mode: 'alongside' };
    case 'searching':
      return b.lastSeen ? { mode: 'search', at: b.lastSeen } : { mode: 'course' };
    case 'standingOff':
      return { mode: 'standOff' };
    case 'captured':
      return { mode: 'alongside' };
    default:
      return { mode: 'course' };
  }
}
