import type { JailFile } from '../../../data/schemas/jail';
import type { CargoStack } from '../economy/hold';
import type { Strongbox } from '../law/jail';
import { defaultShipState, type ShipState } from './shipyard';

/**
 * Abandoning ship (plan 07 §14.6 decision 2, plan 02 §6.5; Phase 6 piece F). When your
 * ship founders you take to the boat: she goes down with her cargo and guns, and a passing
 * vessel lands you at the nearest port with a shipyard. There the yard sells you a worn
 * hull of the smallest class at a share of a new one's price. You pay what you can from
 * your purse, then from your strongboxes by word (the messenger's fee on top), and work off
 * the rest in the yard, a week's wages a game day. The stash's goods and cash are kept.
 */

export interface HullSettlement {
  priceCents: number;
  fromPurse: number;
  /** Cash sent from each strongbox (the messenger's fee included in the first). */
  fromBoxes: { hideout: string; cents: number }[];
  wordFeeCents: number;
  /** Still owed after that, worked off at the yard. */
  owedCents: number;
  workDays: number;
}

/** How the worn hull is paid for: purse first, strongboxes by word, then the yard's work. */
export function settleHull(
  jail: JailFile,
  purse: number,
  boxes: readonly Strongbox[],
  priceCents: number,
): HullSettlement {
  const fromPurse = Math.min(Math.max(0, purse), priceCents);
  let owed = priceCents - fromPurse;
  const fromBoxes: { hideout: string; cents: number }[] = [];
  const fee = jail.sendWord.feeCents;
  let wordFeeCents = 0;
  // The richest first; a box that can't cover the messenger is no use.
  for (const b of [...boxes].sort((a, c) => c.cash - a.cash)) {
    if (owed <= 0) break;
    const feeHere = wordFeeCents === 0 ? fee : 0;
    if (b.cash <= feeHere) continue;
    const cents = Math.min(b.cash - feeHere, owed);
    fromBoxes.push({ hideout: b.id, cents: cents + feeHere });
    wordFeeCents += feeHere;
    owed -= cents;
  }
  const work = jail.abandon.workCentsPerDay;
  return {
    priceCents,
    fromPurse,
    fromBoxes,
    wordFeeCents,
    owedCents: owed,
    workDays: owed > 0 ? Math.ceil(owed / work) : 0,
  };
}

export interface ShipLost {
  classId: string;
  cargo: { good: string; qty: number }[];
  guns: string[];
  ammoCharges: number;
}

/**
 * She's gone: the hold, the loose powder and the guns go down with her, and the captain is
 * left with a worn hull of the yard's (fitted with small arms only). Returns what was lost.
 */
export function loseShip(
  jail: JailFile,
  player: { cargo: CargoStack[]; ship?: ShipState | undefined; ammo: { charges: number } },
): ShipLost {
  const old = player.ship ?? defaultShipState();
  const lost: ShipLost = {
    classId: old.classId,
    cargo: player.cargo.map((s) => ({ good: s.good, qty: s.qty })),
    guns: old.weapons.filter((w) => w.mount !== 'hand').map((w) => w.weapon),
    ammoCharges: player.ammo.charges,
  };
  player.cargo.length = 0;
  player.ammo.charges = 0;
  const ship = defaultShipState(jail.abandon.hullClass);
  ship.hull01 = jail.abandon.wornHull01;
  ship.rigging01 = jail.abandon.wornRigging01;
  player.ship = ship;
  return lost;
}
