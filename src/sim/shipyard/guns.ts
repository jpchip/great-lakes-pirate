import gunsJson from '../../../data/guns.json';
import { gunsFileSchema, type Gun } from '../../../data/schemas/guns';
import type { Mount } from '../../../data/schemas/combat';
import {
  fitRefusal as mountRefusal,
  type FitRefusal,
  type MountedWeapon,
} from '../combat/armament';
import { gameCombat } from '../combat/defs';
import type { EconomyDefs } from '../economy/defs';
import { sailShipRecord } from '../sailing/ships';
import { atPort, type Owner, type ShipState, type ShipyardResult } from './shipyard';

/**
 * The shady shipwright's guns (plan 10 §5.4, §6; Phase 6 piece E, reconciled with piece A).
 * A gun is bought whole and mounted straight into `player.ship.weapons`, where the combat
 * core fires it: each mount goes through piece A's `fitRefusal`, so a class only takes the
 * guns its mounts hold (`weapons.json`). Fame gates the sale and the hull tier gates it,
 * and the price carries the port's spread like the yard's.
 */

let cached: readonly Gun[] | undefined;

/** Every gun the shipwright sells, from `data/guns.json`. */
export function gameGuns(): readonly Gun[] {
  cached ??= gunsFileSchema.parse(gunsJson);
  return cached;
}

export function gunPriceCents(defs: EconomyDefs, port: string, gun: Gun): number {
  return atPort(defs, port, gun.priceCents);
}

export type GunRefusal = FitRefusal | 'fame' | 'hull' | 'noMoney';

/** Why he won't sell her this gun now, or undefined when he will. */
export function gunRefusal(
  defs: EconomyDefs,
  owner: Owner,
  ship: ShipState,
  gun: Gun,
  port: string,
  fameTier: number,
): GunRefusal | undefined {
  if (fameTier < gun.fameTier) return 'fame';
  if ((sailShipRecord(ship.classId).tier ?? 0) < gun.minTier) return 'hull';
  // Each mount the gun takes must have room, counting the ones before it.
  const weapons: MountedWeapon[] = [...ship.weapons];
  for (const mount of gun.mounts) {
    const why = mountRefusal(gameCombat(), ship.classId, weapons, gun.weapon, mount as Mount);
    if (why) return why;
    weapons.push({ weapon: gun.weapon, mount: mount as Mount });
  }
  if (gunPriceCents(defs, port, gun) > owner.purse) return 'noMoney';
  return undefined;
}

export interface GunBoughtEvent {
  port: string;
  gun: string;
  mounts: Mount[];
  cents: number;
}

/** Buys a gun and mounts it on her: all or nothing. */
export function buyGun(
  defs: EconomyDefs,
  owner: Owner,
  ship: ShipState,
  port: string,
  gunId: string,
  fameTier: number,
): ShipyardResult<GunBoughtEvent> {
  const gun = gameGuns().find((g) => g.id === gunId);
  if (!gun) return { ok: false, reason: 'unknown' };
  const why = gunRefusal(defs, owner, ship, gun, port, fameTier);
  if (why) return { ok: false, reason: why };
  const cents = gunPriceCents(defs, port, gun);
  owner.purse -= cents;
  for (const mount of gun.mounts) ship.weapons.push({ weapon: gun.weapon, mount: mount as Mount });
  return { ok: true, event: { port, gun: gun.id, mounts: [...gun.mounts] as Mount[], cents } };
}
