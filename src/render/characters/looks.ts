import type { PortraitDef } from '../../../data/schemas/backgrounds';
import { Rng } from '../../core/rng';
import { PALETTE } from '../style/palette';
import type { BodyId, PieceName } from './humanoid-spec';
import { REGION_COUNT, REGIONS, type RegionName } from './regions';

/**
 * A character's look (plan 08 §13, §20 piece B): which body, which pieces, which hat and
 * what colors. The player's comes from the portrait preset picked at character creation;
 * NPCs come from a role and a seed, so a watchman is always a watchman but no two are
 * quite alike. Pure data: humanoid.ts turns a look into a mesh.
 */

export type HairStyle = 'short' | 'cropped' | 'long' | 'buns' | 'bald';
export type BeardStyle = 'none' | 'full' | 'mustache';
export type HatStyle =
  'none' | 'cap' | 'peaked' | 'bowler' | 'souwester' | 'wool' | 'bonnet' | 'helmet' | 'slouch';
export type HeldProp = 'none' | 'lantern' | 'club' | 'rifle';

export interface Look {
  body: BodyId;
  hair: HairStyle;
  beard: BeardStyle;
  hat: HatStyle;
  /** A jacket (pea coat, reefer, sack coat) over the shirt. */
  jacket: boolean;
  /** In the right hand, unless a clip needs the hand. */
  held: HeldProp;
  /** sRGB hex per region; missing regions take the defaults. */
  colors: Partial<Record<RegionName, number>>;
}

/** Colors every look starts from: work clothes in the photochrom palette. */
export const DEFAULT_COLORS: Readonly<Record<RegionName, number>> = {
  skin: 0xc99872,
  eyeWhite: 0xd8d2c4,
  iris: 0x2b2118,
  hair: 0x4a3828,
  shirt: 0xc9bea2,
  vest: 0x4a3b2c,
  trousers: 0x3b3a36,
  boots: 0x3a2a1e,
  leather: 0x2e2219,
  metal: 0x8f8a7c,
  coat: 0x2f3b4a,
  coatTrim: 0x23282a,
  hat: 0x2c2a27,
  hatBand: 0x1e1c1a,
  lampGlass: PALETTE.lampAmber,
  prop: 0x3a3833,
};

export function hexColor(css: string): number {
  return Number.parseInt(css.replace('#', ''), 16);
}

const PORTRAIT_HATS: Record<PortraitDef['hat'], HatStyle> = {
  none: 'none',
  cap: 'cap',
  "sou'wester": 'souwester',
  bowler: 'bowler',
  wool: 'wool',
  bonnet: 'bonnet',
};

const PORTRAIT_HAIR: Record<PortraitDef['hairStyle'], HairStyle> = {
  short: 'short',
  long: 'long',
  braid: 'buns',
};

/** Slightly darker: hat bands, trims. */
function shade(hex: number, f: number): number {
  const r = Math.round(((hex >> 16) & 255) * f);
  const g = Math.round(((hex >> 8) & 255) * f);
  const b = Math.round((hex & 255) * f);
  return (Math.min(255, r) << 16) | (Math.min(255, g) << 8) | Math.min(255, b);
}

/**
 * The player's look from their portrait preset. Saves from 0.6.0 keep their preset and
 * get its body (plan 08 §20.5). The sou'wester is oilskin yellow, as the portrait paints it.
 */
export function lookFromPortrait(p: PortraitDef): Look {
  const hat = PORTRAIT_HATS[p.hat];
  const coat = hexColor(p.coat);
  return {
    body: p.body,
    hair: PORTRAIT_HAIR[p.hairStyle],
    beard: p.body === 'female' ? 'none' : p.beard,
    hat,
    jacket: true,
    held: 'none',
    colors: {
      skin: hexColor(p.skin),
      hair: hexColor(p.hair),
      coat,
      coatTrim: shade(coat, 0.7),
      hat: hat === 'souwester' ? 0xb08a2e : hat === 'wool' ? shade(coat, 0.9) : 0x2a2622,
      hatBand: hat === 'bonnet' ? coat : 0x1a1714,
    },
  };
}

export type NpcRole =
  'watchman' | 'constable' | 'sailor' | 'marshal' | 'dockhand' | 'townsman' | 'townswoman';

export const NPC_ROLES: readonly NpcRole[] = [
  'watchman',
  'constable',
  'sailor',
  'marshal',
  'dockhand',
  'townsman',
  'townswoman',
];

const SKINS = [0xe1b897, 0xd8a982, 0xc99872, 0xb98560, 0xa8714d, 0x8d5a3b, 0x6e4630];
const HAIRS = [0x2b2118, 0x3c2a1c, 0x5a4632, 0x6e3f22, 0xa9783f, 0x8a8478, 0xb9b4ab, 0x1e1914];
const DRAB = [0x4a4038, 0x5b4636, 0x3e4436, 0x56503f, 0x4b4a46, 0x6a5a44];

function pick<T>(rng: Rng, list: readonly T[]): T {
  return rng.pick(list);
}

/**
 * An NPC's look by role (plan 08 §5.1): the role fixes the silhouette and the colors that
 * identify it at night (the constable's blue and helmet, the watchman's lantern), the seed
 * varies the face, hair and drab clothes.
 */
export function npcLook(role: NpcRole, seed: string | number): Look {
  const rng = Rng.fromSeed(`${role}:${seed}`);
  const skin = pick(rng, SKINS);
  const hair = pick(rng, HAIRS);
  const beard: BeardStyle = rng.next() < 0.45 ? 'full' : rng.next() < 0.5 ? 'mustache' : 'none';
  const base = { skin, hair };
  switch (role) {
    case 'watchman':
      return {
        body: 'male',
        hair: 'short',
        beard,
        hat: rng.next() < 0.5 ? 'cap' : 'bowler',
        jacket: true,
        held: 'lantern',
        colors: { ...base, coat: pick(rng, DRAB), trousers: 0x34322e, hat: 0x2e2a25 },
      };
    case 'constable':
      return {
        body: 'male',
        hair: 'cropped',
        beard: beard === 'full' ? 'mustache' : beard,
        hat: 'helmet',
        jacket: true,
        held: 'club',
        colors: {
          ...base,
          coat: 0x1f2a44,
          coatTrim: 0x161d30,
          trousers: 0x1c2232,
          hat: 0x1f2a44,
          hatBand: 0x8f8a7c,
          boots: 0x1a1714,
        },
      };
    case 'marshal':
      return {
        body: 'male',
        hair: 'short',
        beard: beard === 'none' ? 'mustache' : beard,
        hat: 'slouch',
        jacket: true,
        held: 'rifle',
        colors: { ...base, coat: 0x5a4a36, trousers: 0x3a3630, hat: 0x6a5a44, hatBand: 0x2a2018 },
      };
    case 'sailor':
      return {
        body: 'male',
        hair: rng.next() < 0.5 ? 'short' : 'cropped',
        beard,
        hat: rng.next() < 0.6 ? 'wool' : 'cap',
        jacket: rng.next() < 0.6,
        held: 'none',
        colors: {
          ...base,
          coat: 0x232b38,
          shirt: rng.next() < 0.5 ? 0xd8d0bc : 0x34465e,
          trousers: 0x2a3140,
          hat: rng.next() < 0.5 ? 0x232b38 : 0x7a2e26,
        },
      };
    case 'dockhand':
      return {
        body: 'male',
        hair: pick(rng, ['short', 'cropped', 'long'] as const),
        beard,
        hat: rng.next() < 0.6 ? 'cap' : 'none',
        jacket: false,
        held: 'none',
        colors: {
          ...base,
          shirt: pick(rng, [0xc9bea2, 0x7a6a50, 0x8a5a44, 0x5a6470]),
          trousers: pick(rng, DRAB),
        },
      };
    case 'townsman':
      return {
        body: 'male',
        hair: 'short',
        beard,
        hat: rng.next() < 0.6 ? 'bowler' : 'none',
        jacket: true,
        held: 'none',
        colors: {
          ...base,
          coat: pick(rng, [0x2c2a27, 0x3a2c22, 0x4b4a46, 0x2f3b4a]),
          trousers: 0x3b3a36,
        },
      };
    case 'townswoman':
      return {
        body: 'female',
        hair: pick(rng, ['buns', 'long'] as const),
        beard: 'none',
        hat: rng.next() < 0.5 ? 'bonnet' : 'none',
        jacket: rng.next() < 0.4,
        held: 'none',
        colors: {
          ...base,
          shirt: pick(rng, [0xd8d0bc, 0xc9bea2, 0xb7a68a]),
          vest: pick(rng, [0x4a3550, 0x2f5a5c, 0x5b3a2c, 0x3a3a46]),
          coat: pick(rng, [0x4a3550, 0x2f3b4a, 0x3a2c22]),
          trousers: 0x2c2a27,
          hat: 0x3a2c22,
          hatBand: pick(rng, [0x8a3426, 0x2f5a5c, 0x4a3550]),
        },
      };
  }
}

/** The mesh pieces a look needs, before hats and props. */
export function lookPieces(look: Look): PieceName[] {
  const pieces: PieceName[] = ['head', 'hands', look.jacket ? 'jacket' : 'shirt', 'legs', 'boots'];
  // Long hair under a sou'wester or helmet reads fine; buns under a bonnet too.
  const hair: Record<HairStyle, PieceName | null> = {
    short: 'hair.short',
    cropped: 'hair.cropped',
    long: 'hair.long',
    buns: look.body === 'female' ? 'hair.buns' : 'hair.long',
    bald: null,
  };
  // A close hat covers parted hair; crop it so it can't poke through.
  const close = (['wool', 'helmet', 'bowler', 'souwester'] as HatStyle[]).includes(look.hat);
  const style = hair[look.hair === 'short' && close ? 'cropped' : look.hair];
  if (style) pieces.push(style);
  if (look.beard === 'full' && look.body === 'male') pieces.push('beard.full');
  return pieces;
}

/** Region colors in REGIONS order, for the material's palette uniform. */
export function lookPalette(look: Look): number[] {
  return REGIONS.map((r) => look.colors[r] ?? DEFAULT_COLORS[r]);
}

/** Geometry cache key: looks that differ only in color share a mesh. */
export function lookShapeKey(look: Look): string {
  return [
    look.body,
    ...lookPieces(look),
    `hat:${look.hat}`,
    `beard:${look.beard}`,
    `held:${look.held}`,
  ].join('|');
}

export { REGION_COUNT };
