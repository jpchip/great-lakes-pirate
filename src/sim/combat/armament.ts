import type { Mount, WeaponDef } from '../../../data/schemas/combat';
import { reduceStack, type Hold } from '../economy/hold';
import { launchVelocity, type Vec3 } from './ballistics';
import { ammoDef, weaponDef, type CombatDefs } from './defs';
import { toWorld, type HullPose, type HullShape } from './hull';
import type { Random } from './damage';

/**
 * The player's guns (plan 07 §2, §3; Phase 6 piece A): what's mounted where, the powder
 * in the magazine, reloading, and laying a gun or a broadside to throw its shot. Aim mode
 * and its camera are piece B; this is what B (and the dev hook) call to fire.
 */

/** A gun in its place (plan 07 §10 `player.ship.weapons[]`). */
export interface MountedWeapon {
  weapon: string;
  mount: Mount;
}

/** Loose powder charges out of opened kegs (plan 07 §10 `player.ammo`). */
export interface AmmoState {
  charges: number;
}

const DEG = Math.PI / 180;

/** The Ex-Navy's Gunnery (plan 12 §2.2): tighter aim, and the swivel loads faster. */
export const GUNNERY_SPREAD = 0.7;
export const GUNNERY_SWIVEL_RELOAD = 0.8;
/** Elevation scatter as a share of the gun's spread in bearing. */
const ELEVATION_SCATTER = 0.5;

/** The mounts a weapon kind can go in. */
export function mountsFor(w: WeaponDef): readonly Mount[] {
  switch (w.kind) {
    case 'swivel':
      return ['bow'];
    case 'broadside':
      return ['port', 'starboard'];
    case 'small_arms':
      return ['hand'];
  }
}

/** How many guns a mount holds on this class. */
export function mountCapacity(defs: CombatDefs, classId: string, mount: Mount): number {
  const m = defs.mounts[classId];
  if (!m) return 0;
  return mount === 'bow' ? m.bow : mount === 'hand' ? m.hand : m.broadside;
}

export type FitRefusal = 'unknownWeapon' | 'wrongMount' | 'noRoom';

/** Why a gun can't go in a mount on this class; undefined when it can. */
export function fitRefusal(
  defs: CombatDefs,
  classId: string,
  weapons: readonly MountedWeapon[],
  weaponId: string,
  mount: Mount,
): FitRefusal | undefined {
  const w = defs.weapons.get(weaponId);
  if (!w) return 'unknownWeapon';
  if (!mountsFor(w).includes(mount)) return 'wrongMount';
  const used = weapons.filter((m) => m.mount === mount).length;
  return used >= mountCapacity(defs, classId, mount) ? 'noRoom' : undefined;
}

/** Guns that no longer fit a new hull stay ashore (piece E prices the move, plan 10 §3). */
export function fittingWeapons(
  defs: CombatDefs,
  classId: string,
  weapons: readonly MountedWeapon[],
): MountedWeapon[] {
  const out: MountedWeapon[] = [];
  for (const m of weapons) {
    if (!fitRefusal(defs, classId, out, m.weapon, m.mount)) out.push({ ...m });
  }
  return out;
}

/** Where a mount's arc is centered, off the bow, radians (small arms: anywhere). */
export function arcCenter(mount: Mount): number {
  return mount === 'port' ? -Math.PI / 2 : mount === 'starboard' ? Math.PI / 2 : 0;
}

/** Whether a bearing off the bow (radians, + to starboard) is inside the mount's arc. */
export function inArc(w: WeaponDef, mount: Mount, relBearing: number): boolean {
  if (w.arcDeg >= 360) return true;
  const d = Math.atan2(
    Math.sin(relBearing - arcCenter(mount)),
    Math.cos(relBearing - arcCenter(mount)),
  );
  return Math.abs(d) <= (w.arcDeg / 2) * DEG;
}

/** The mount a bearing off the bow is best served from, among those armed. */
export function mountFor(
  defs: CombatDefs,
  weapons: readonly MountedWeapon[],
  relBearing: number,
  prefer?: Mount,
): Mount | undefined {
  const armed = (mount: Mount): boolean => {
    const m = weapons.find((x) => x.mount === mount);
    return !!m && inArc(weaponDef(defs, m.weapon), mount, relBearing);
  };
  if (prefer) return armed(prefer) ? prefer : undefined;
  for (const mount of ['port', 'starboard', 'bow', 'hand'] as const) if (armed(mount)) return mount;
  return undefined;
}

export function reloadSeconds(w: WeaponDef, crewed: boolean, gunnery: boolean): number {
  const base = crewed ? w.reloadCrewedS : w.reloadSoloS;
  return gunnery && w.kind === 'swivel' ? base * GUNNERY_SWIVEL_RELOAD : base;
}

/** Charges ready to fire: the loose ones and every keg in the hold. */
export function chargesAvailable(defs: CombatDefs, hold: Hold, ammo: AmmoState): number {
  const kegs = hold.filter((s) => s.good === defs.powder.good).reduce((n, s) => n + s.qty, 0);
  return ammo.charges + kegs * defs.powder.chargesPerCu;
}

/**
 * Burns `n` charges, opening kegs of powder and shot from the hold as the loose ones run
 * out (plan 07 §2.2: ammo is cargo, used per shot). False, and nothing spent, if there
 * isn't enough. Clean kegs are opened before stolen ones.
 */
export function spendCharges(defs: CombatDefs, hold: Hold, ammo: AmmoState, n: number): boolean {
  if (n <= 0) return true;
  if (chargesAvailable(defs, hold, ammo) < n) return false;
  while (ammo.charges < n) {
    let idx = -1;
    for (let i = hold.length - 1; i >= 0; i--) {
      const s = hold[i];
      if (s?.good !== defs.powder.good) continue;
      if (idx < 0 || (!s.hot && !s.contract)) idx = i;
    }
    const stack = hold[idx];
    if (!stack) return false;
    reduceStack(stack, 1);
    if (stack.qty <= 0) hold.splice(idx, 1);
    ammo.charges += defs.powder.chargesPerCu;
  }
  ammo.charges -= n;
  return true;
}

/** A standard normal draw (Box–Muller). */
export function gaussian(rng: Random): number {
  const u = Math.max(1e-12, rng.next());
  const v = rng.next();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * Where a mount's guns stand on her deck, local frame: the swivel on the bow, a broadside's
 * guns spaced along the side, small arms at the rail amidships.
 */
export function muzzlesLocal(shape: HullShape, mount: Mount, guns: number): Vec3[] {
  const y = shape.freeboardM + 0.8;
  if (mount === 'bow') return [{ x: 0, y, z: shape.halfLength * 0.85 }];
  if (mount === 'hand') return [{ x: 0, y: shape.freeboardM + 1.4, z: 0 }];
  const side = mount === 'starboard' ? 1 : -1;
  const out: Vec3[] = [];
  for (let i = 0; i < guns; i++) {
    const along = guns === 1 ? 0 : (i / (guns - 1) - 0.5) * shape.halfLength * 0.9;
    out.push({ x: side * shape.halfBeam, y: shape.freeboardM * 0.85, z: along });
  }
  return out;
}

/** One round leaving a muzzle. */
export interface Round {
  weapon: string;
  ammo: string;
  pos: Vec3;
  vel: Vec3;
}

/**
 * Lays every gun on a mount at a bearing and elevation and fires: each round scattered by
 * the gun's spread (times the ammo's, less with Gunnery), carrying the ship's own way.
 */
export function layRounds(
  defs: CombatDefs,
  guns: readonly MountedWeapon[],
  shape: HullShape,
  pose: HullPose,
  shipVel: { x: number; z: number },
  bearing: number,
  elevation: number,
  ammoId: string,
  rng: Random,
  gunnery: boolean,
): Round[] {
  const first = guns[0];
  if (!first) return [];
  const muzzles = muzzlesLocal(shape, first.mount, guns.length);
  return guns.map((g, i) => {
    const w = weaponDef(defs, g.weapon);
    const a = ammoDef(defs, ammoId);
    const sigma =
      w.spreadDeg * DEG * a.spreadMul * (gunnery && w.kind !== 'small_arms' ? GUNNERY_SPREAD : 1);
    const b = bearing + gaussian(rng) * sigma;
    // The barrel's elevation is held closer than its train; a ship's roll (piece B) adds to it.
    const e = elevation + gaussian(rng) * sigma * ELEVATION_SCATTER;
    const v = launchVelocity(w.muzzleMs, b, e);
    return {
      weapon: g.weapon,
      ammo: ammoId,
      pos: toWorld(muzzles[i] ?? muzzles[0] ?? { x: 0, y: 2, z: 0 }, pose),
      vel: { x: v.x + shipVel.x, y: v.y, z: v.z + shipVel.z },
    };
  });
}

/** The reach of a gun with an ammo, meters (grape scatters early). */
export function reachM(defs: CombatDefs, weaponId: string, ammoId: string): number {
  return weaponDef(defs, weaponId).rangeM * ammoDef(defs, ammoId).rangeMul;
}
