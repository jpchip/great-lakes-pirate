import ammoJson from '../../../data/ammo.json';
import weaponsJson from '../../../data/weapons.json';
import {
  ammoFileSchema,
  weaponsFileSchema,
  type AmmoDef,
  type AmmoFile,
  type PoolDamage,
  type WeaponDef,
  type WeaponsFile,
} from '../../../data/schemas/combat';

/**
 * Guns and shot (plan 07 §2; Phase 6 piece A), validated and indexed once. Tests build
 * their own with `compileCombat` to tune numbers.
 */
export interface CombatDefs {
  weapons: ReadonlyMap<string, WeaponDef>;
  ammo: ReadonlyMap<string, AmmoDef>;
  /** Guns each player class carries, by class id. */
  mounts: WeaponsFile['mounts'];
  powder: AmmoFile['powder'];
}

export function compileCombat(weapons: WeaponsFile, ammo: AmmoFile): CombatDefs {
  const ammoById = new Map<string, AmmoDef>();
  for (const a of ammo.ammo) {
    if (ammoById.has(a.id)) throw new Error(`Duplicate ammo ${a.id}`);
    ammoById.set(a.id, a);
  }
  for (const a of ammo.ammo) {
    if (a.as && !ammoById.has(a.as)) throw new Error(`${a.id} fires unknown ${a.as}`);
    if (a.warning && !a.as) throw new Error(`Warning shot ${a.id} must name the ammo it fires`);
  }
  const byId = new Map<string, WeaponDef>();
  for (const w of weapons.weapons) {
    if (byId.has(w.id)) throw new Error(`Duplicate weapon ${w.id}`);
    for (const a of w.ammo) {
      const def = ammoById.get(a);
      if (!def) throw new Error(`${w.id} fires unknown ${a}`);
      if (def.as && !w.damage[def.as]) throw new Error(`${w.id} fires ${a} without ${def.as}`);
    }
    byId.set(w.id, w);
  }
  return { weapons: byId, ammo: ammoById, mounts: weapons.mounts, powder: ammo.powder };
}

let cached: CombatDefs | undefined;

/** The game's guns and shot from the data files. */
export function gameCombat(): CombatDefs {
  cached ??= compileCombat(weaponsFileSchema.parse(weaponsJson), ammoFileSchema.parse(ammoJson));
  return cached;
}

export function weaponDef(defs: CombatDefs, id: string): WeaponDef {
  const w = defs.weapons.get(id);
  if (!w) throw new Error(`No weapon ${id}`);
  return w;
}

export function ammoDef(defs: CombatDefs, id: string): AmmoDef {
  const a = defs.ammo.get(id);
  if (!a) throw new Error(`No ammo ${id}`);
  return a;
}

/** The ammo a shot actually is: a warning shot is round shot laid to miss. */
export function firedAs(defs: CombatDefs, ammoId: string): AmmoDef {
  const a = ammoDef(defs, ammoId);
  return a.as ? ammoDef(defs, a.as) : a;
}

/** What a hit from this gun and ammo does to each pool. */
export function damageOf(defs: CombatDefs, weaponId: string, ammoId: string): PoolDamage {
  const w = weaponDef(defs, weaponId);
  const d = w.damage[firedAs(defs, ammoId).id];
  if (!d) throw new Error(`${weaponId} has no damage for ${ammoId}`);
  return d;
}
