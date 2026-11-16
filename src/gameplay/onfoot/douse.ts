import type { DistrictLamp } from '../district/district';
import type { Lamp } from './light';

/**
 * Putting out a lamp (plan 08 §6 "Extinguish lamp", §17 cut #3 taken back; Phase 7
 * follow-up). After dark, F held at the foot of a lit gas lamp turns its gas down, and at a
 * lantern on a post or a hook blows it out: its pool is gone from the light gem, the
 * guards' sight and the screen. It makes a little noise, and a guard who sees you do it
 * grows wary. A guard on his round who sees a lamp out goes over and lights it again
 * (`stealth.ts`); at dawn they all go out, and the lamplighter lights every one at dusk.
 */

/** From the post, meters, across the ground. */
export const DOUSE_REACH_M = 1.3;
/** The flame may be this far above your feet at most (a gas lamp's head from the street). */
const DOUSE_ABOVE_M = 4;

export interface DouseOffer {
  /** Index into the district's lamps (and the watch's perception lamps). */
  lamp: number;
  label: string;
  /** Seconds F is held. */
  holdS: number;
}

/** Seconds F is held to turn down a gas lamp's cock, or to blow out a lantern. */
export const GAS_HOLD_S = 1.5;
export const LANTERN_HOLD_S = 0.8;

/**
 * What F would put out from where you stand: the nearest lit lamp in reach. `lamps` and
 * `defs` are the same district lamps, in the same order (`districtLamps`).
 */
export function douseOffer(
  lamps: readonly Lamp[],
  defs: readonly DistrictLamp[],
  feet: { x: number; y: number; z: number },
): DouseOffer | undefined {
  let best: DouseOffer | undefined;
  let bestD = DOUSE_REACH_M;
  lamps.forEach((l, k) => {
    if (!l.lit || l.doused) return;
    const above = l.y - feet.y;
    if (above < 0.3 || above > DOUSE_ABOVE_M) return;
    const d = Math.hypot(l.x - feet.x, l.z - feet.z);
    if (d > bestD) return;
    bestD = d;
    const gas = defs[k]?.piece === 'kit.gas_lamp';
    best = {
      lamp: k,
      label: gas ? 'Turn down the gas lamp' : 'Blow out the lantern',
      holdS: gas ? GAS_HOLD_S : LANTERN_HOLD_S,
    };
  });
  return best;
}

/** Puts the lamp out. */
export function douse(l: Lamp): void {
  l.doused = true;
  l.lit = false;
}
