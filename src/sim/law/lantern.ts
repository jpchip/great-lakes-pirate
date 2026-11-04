import { z } from 'zod';

/**
 * The ship's lantern (plan 02 §2, plan 06 §7.1; Phase 5 piece B): her running lights, lit
 * or doused with L. Lit, she shows red, green and a white stern light and burns the lamp
 * oil the chandlery sells; dark, she's harder to see at night (dark running), and nothing
 * else in the traffic can see her either. Pure: the gameplay layer keys it and saves it.
 */

export const LAMP_OIL_ID = 'store.lamp_oil';

/**
 * A can of kerosene keeps the lamps lit "a week of nights" (data/stores.json): seven nights
 * of ten hours, in game seconds.
 */
export const CAN_BURN_GAME_S = 7 * 10 * 3600;

export const lanternStateSchema = z.object({
  lit: z.boolean(),
  /** Game seconds of oil left in the lamps from the can now open. */
  fuelS: z.number().nonnegative(),
});
export type LanternState = z.infer<typeof lanternStateSchema>;

export function createLantern(): LanternState {
  return { lit: false, fuelS: 0 };
}

type Stores = Record<string, number>;

/** Lamp oil aboard, in cans: the full ones in the locker plus what's in the lamps. */
export function oilCans(lantern: LanternState, stores: Readonly<Stores>): number {
  return (stores[LAMP_OIL_ID] ?? 0) + lantern.fuelS / CAN_BURN_GAME_S;
}

/** Nights of light left aboard (10 h a night). */
export function oilNights(lantern: LanternState, stores: Readonly<Stores>): number {
  return (oilCans(lantern, stores) * CAN_BURN_GAME_S) / (10 * 3600);
}

export type LanternToggle = 'lit' | 'doused' | 'noOil';

/**
 * L: light the lamps (opening a can if the lamps are dry) or douse them. Refused with
 * `noOil` when there's none aboard.
 */
export function toggleLantern(lantern: LanternState, stores: Stores): LanternToggle {
  if (lantern.lit) {
    lantern.lit = false;
    return 'doused';
  }
  if (lantern.fuelS <= 0) {
    const cans = stores[LAMP_OIL_ID] ?? 0;
    if (cans <= 0) return 'noOil';
    stores[LAMP_OIL_ID] = cans - 1;
    lantern.fuelS = CAN_BURN_GAME_S;
  }
  lantern.lit = true;
  return 'lit';
}

/**
 * Burns `dtGameS` of oil while lit, opening the next can as one runs dry. Returns true
 * when the last of it burned out and the lamps went dark.
 */
export function burnLantern(lantern: LanternState, stores: Stores, dtGameS: number): boolean {
  if (!lantern.lit || dtGameS <= 0) return false;
  lantern.fuelS -= dtGameS;
  while (lantern.fuelS <= 0) {
    const cans = stores[LAMP_OIL_ID] ?? 0;
    if (cans <= 0) {
      lantern.fuelS = 0;
      lantern.lit = false;
      return true;
    }
    stores[LAMP_OIL_ID] = cans - 1;
    lantern.fuelS += CAN_BURN_GAME_S;
  }
  return false;
}
