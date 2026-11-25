import cosmeticsJson from '../../../data/cosmetics.json';
import {
  COSMETIC_KINDS,
  cosmeticsFileSchema,
  type CosmeticKind,
  type CosmeticOption,
  type CosmeticsFile,
} from '../../../data/schemas/cosmetics';
import { NAME_MAX } from '../character/new-run';
import type { Owner, ShipState } from './shipyard';

/**
 * Paint, canvas, pennant and her name (plan 10 §3, §7; Phase 10): cosmetic only, done at
 * a shipyard or a hideout slipway, cheap and quick. None of it touches her sailing, her
 * price or the law's profile of her (plan 06 §2.3): a new coat of paint or a new name on
 * the transom sheds no heat. Pure functions over `player.ship` and the purse, all or
 * nothing, each returning what happened for the caller to raise on the bus.
 */

export { COSMETIC_KINDS, type CosmeticKind, type CosmeticOption };

let cached: { file: CosmeticsFile; byId: Map<string, CosmeticOption> } | undefined;
function defs(): { file: CosmeticsFile; byId: Map<string, CosmeticOption> } {
  if (!cached) {
    const file = cosmeticsFileSchema.parse(cosmeticsJson);
    cached = { file, byId: new Map(file.options.map((o) => [o.id, o])) };
  }
  return cached;
}

export const cosmeticOption = (id: string): CosmeticOption | undefined => defs().byId.get(id);

export const cosmeticOptions = (kind: CosmeticKind): CosmeticOption[] =>
  defs().file.options.filter((o) => o.kind === kind);

/** The option she shows for a kind: the one chosen, or her class's own colors. */
export function currentCosmetic(
  ship: Pick<ShipState, 'classId' | 'cosmetics'>,
  kind: CosmeticKind,
): string | undefined {
  return ship.cosmetics?.[kind] ?? defs().file.classDefaults[ship.classId]?.[kind];
}

/** Tanned canvas (`upgrade.dark_sails`) takes no other sail color. */
export const hasTannedSails = (ship: Pick<ShipState, 'upgrades'>): boolean =>
  ship.upgrades.includes('upgrade.dark_sails');

/** What a kind of work costs and how long a yard takes over it; a slipway's is your own time. */
export const cosmeticWork = (kind: CosmeticKind | 'name'): { priceCents: number; hours: number } =>
  defs().file.work[kind];

/** The canvas of `upgrade.dark_sails`: tanned the color of a wet hull (plan 10 §5.2). */
export const DARK_SAILS_COLOR = 0x5a4a3a;

/** Colors to draw her in, 0xrrggbb; absent keeps the class's own. */
export interface ShipLivery {
  topsides?: number;
  trim?: number;
  canvas?: number;
  pennant?: number;
  /** A two-color pennant's fly. */
  pennantFly?: number;
}

const hex = (c: string): number => parseInt(c.slice(1), 16);

/** Her colors as fitted: the cosmetics chosen, and tanned canvas over any sail color. */
export function liveryOf(ship: Pick<ShipState, 'cosmetics' | 'upgrades'>): ShipLivery {
  const l: ShipLivery = {};
  const pick = (kind: CosmeticKind): CosmeticOption | undefined => {
    const id = ship.cosmetics?.[kind];
    const o = id ? cosmeticOption(id) : undefined;
    return o?.kind === kind ? o : undefined;
  };
  const hull = pick('hull');
  if (hull) l.topsides = hex(hull.color);
  const trim = pick('trim');
  if (trim) l.trim = hex(trim.color);
  const sails = pick('sails');
  if (sails) l.canvas = hex(sails.color);
  if (hasTannedSails(ship)) l.canvas = DARK_SAILS_COLOR;
  const pennant = pick('pennant');
  if (pennant) {
    l.pennant = hex(pennant.color);
    if (pennant.fly) l.pennantFly = hex(pennant.fly);
  }
  return l;
}

export type CosmeticRefusal = 'unknown' | 'same' | 'noMoney' | 'badName' | 'tanned';

export interface CosmeticEvent {
  port: string;
  kind: CosmeticKind | 'name';
  /** The option id, or the new name. */
  value: string;
  cents: number;
  hours: number;
  /** Done by your own hands at a hideout slipway, out of the stores. */
  how?: 'slipway';
}

export type CosmeticResult =
  { ok: true; event: CosmeticEvent } | { ok: false; reason: CosmeticRefusal };

/** Paints her, bends new canvas or runs up a new pennant. */
export function applyCosmetic(
  owner: Owner,
  ship: ShipState,
  port: string,
  optionId: string,
): CosmeticResult {
  const o = cosmeticOption(optionId);
  if (!o) return { ok: false, reason: 'unknown' };
  if (currentCosmetic(ship, o.kind) === o.id) return { ok: false, reason: 'same' };
  if (o.kind === 'sails' && hasTannedSails(ship)) return { ok: false, reason: 'tanned' };
  const work = cosmeticWork(o.kind);
  if (work.priceCents > owner.purse) return { ok: false, reason: 'noMoney' };
  owner.purse -= work.priceCents;
  ship.cosmetics = { ...ship.cosmetics, [o.kind]: o.id };
  return {
    ok: true,
    event: { port, kind: o.kind, value: o.id, cents: work.priceCents, hours: work.hours },
  };
}

/** A ship's name tidied the way character creation tidies it; undefined if it won't do. */
export function cleanShipName(name: string): string | undefined {
  const clean = name.trim().replace(/\s+/g, ' ');
  return clean && clean.length <= NAME_MAX ? clean : undefined;
}

/**
 * New letters on her transom and nameboards (plan 10 §3). `captain.shipName` changes; the
 * law's profile keeps the name it knew her by, so it sheds nothing (plan 06 §2.3).
 */
export function renameShip(
  owner: Owner,
  captain: { shipName: string },
  port: string,
  name: string,
): CosmeticResult {
  const clean = cleanShipName(name);
  if (!clean) return { ok: false, reason: 'badName' };
  if (clean === captain.shipName) return { ok: false, reason: 'same' };
  const work = cosmeticWork('name');
  if (work.priceCents > owner.purse) return { ok: false, reason: 'noMoney' };
  owner.purse -= work.priceCents;
  captain.shipName = clean;
  return {
    ok: true,
    event: { port, kind: 'name', value: clean, cents: work.priceCents, hours: work.hours },
  };
}
