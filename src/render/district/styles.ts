import type { DistrictBuilding } from '../../gameplay/district/district';

/**
 * How each building in a docks district is dressed (the 0.9 district polish): siding,
 * paint and trim, roof, and the small things that tell a house from a fish shed. Bayfield
 * and Duluth in the 1890s were frame towns with a brick civic core: clapboard and a
 * contrasting trim for houses, shops and offices; board-and-batten, red oxide or bare
 * weathered boards for the waterfront's sheds and warehouses; brick with stone sills for
 * the lockup, the police and the depot. A building's layout `paint` picks a scheme within
 * its kind, so the editor's paint control still varies neighbors.
 */

export type Siding = 'clapboard' | 'batten' | 'brick';
export type Cornice = 'plain' | 'bracketed' | 'pediment' | 'stepped';

export interface BuildingStyle {
  siding: Siding;
  /** Wall paint (brick for brick). */
  wall: number;
  /** Corner boards, casings, frieze and cornice. */
  trim: number;
  /** Window sash, shutters. */
  sash: number;
  /** The door leaf. */
  door: number;
  roof: number;
  /** Shutters either side of the outside windows. */
  shutters: boolean;
  /** A planter under the outside windows. */
  flowerBoxes: boolean;
  /** Curtains in the windows (lived-in or kept rooms; not sheds). */
  curtains: boolean;
  /** A bracketed hood over the outside doors. */
  doorHood: boolean;
  /** A glazed transom over the doors. */
  transom: boolean;
  /** A canvas or plank awning across the street front (false-front shops). */
  awning: { kind: 'canvas' | 'plank'; a: number; b: number } | undefined;
  /** The false front's top. */
  cornice: Cornice;
  /** Louvered ventilators along the ridge (fish sheds, ice houses, warehouses). */
  ventilators: number;
}

// Late-1800s house paints, softened to the photochrom palette (plan 14 §2).
const WHITE = 0xe4ddca;
const CREAM = 0xd8c99f;
const BUFF = 0xc9ae78;
const STONE_GRAY = 0xb5b0a2;
const SAGE = 0x8e9a7f;
const OCHRE = 0xc49a52;
const SLATE_BLUE = 0x7b8a92;
const OXBLOOD = 0x6c2b22;
const RED_OXIDE = 0x8a3a2a;
const BOTTLE_GREEN = 0x2f4a3b;
const OLIVE = 0x5f6440;
const UMBER = 0x5b3f2b;
const WEATHERED = 0x8b857a;
const SILVERED = 0x9c978b;
const TAR_BROWN = 0x6b5a48;
const BRICK = 0x9a4a36;
const BRICK_DARK = 0x7d3a2b;
const CREAM_BRICK = 0xc9b48a;

// Roofs: cedar shingle, weathered shingle, slate, tin, tar.
const SHINGLE = 0x5e4a3a;
const SHINGLE_GRAY = 0x66615a;
const SLATE = 0x464a4d;
const TIN_RED = 0x7a3b2e;
const TIN = 0x707572;
const TAR = 0x3a3836;

interface Scheme {
  wall: number;
  trim: number;
  sash: number;
  door: number;
  roof: number;
}

const s = (wall: number, trim: number, sash: number, door: number, roof: number): Scheme => ({
  wall,
  trim,
  sash,
  door,
  roof,
});

/** Houses and boarding houses: white with green shutters, cream with brown, and the rest. */
const HOUSE: readonly Scheme[] = [
  s(WHITE, WHITE, BOTTLE_GREEN, BOTTLE_GREEN, SHINGLE),
  s(CREAM, UMBER, UMBER, OXBLOOD, SHINGLE_GRAY),
  s(OCHRE, WHITE, OXBLOOD, OXBLOOD, SLATE),
  s(STONE_GRAY, WHITE, OXBLOOD, UMBER, SHINGLE),
  s(SAGE, CREAM, OLIVE, OXBLOOD, SHINGLE_GRAY),
  s(SLATE_BLUE, WHITE, BOTTLE_GREEN, UMBER, SLATE),
];

/** Shops, the saloon and offices on the front street. */
const SHOP: readonly Scheme[] = [
  s(WHITE, BOTTLE_GREEN, BOTTLE_GREEN, BOTTLE_GREEN, TIN),
  s(BOTTLE_GREEN, CREAM, CREAM, OXBLOOD, TAR),
  s(BUFF, OXBLOOD, OXBLOOD, OXBLOOD, TIN_RED),
  s(STONE_GRAY, UMBER, UMBER, UMBER, TIN),
  s(OXBLOOD, CREAM, CREAM, BOTTLE_GREEN, TAR),
  s(SLATE_BLUE, WHITE, WHITE, OXBLOOD, TIN),
];

/** Warehouses, fish sheds, ice houses, the cooperage: red oxide, bare boards, tar brown. */
const WORK: readonly Scheme[] = [
  s(RED_OXIDE, CREAM, CREAM, UMBER, SHINGLE_GRAY),
  s(SILVERED, WEATHERED, UMBER, UMBER, SHINGLE),
  s(RED_OXIDE, WHITE, WHITE, RED_OXIDE, TIN),
  s(WEATHERED, SILVERED, UMBER, UMBER, SHINGLE_GRAY),
  s(TAR_BROWN, CREAM, CREAM, UMBER, TAR),
  s(OCHRE, UMBER, UMBER, UMBER, SHINGLE),
];

/** Brick civic buildings: common red brick, a darker burned brick, Milwaukee cream. */
const CIVIC: readonly Scheme[] = [
  s(BRICK, STONE_GRAY, BOTTLE_GREEN, UMBER, SLATE),
  s(BRICK_DARK, CREAM, UMBER, OXBLOOD, SLATE),
  s(CREAM_BRICK, STONE_GRAY, BOTTLE_GREEN, UMBER, TIN_RED),
];

const WORK_KINDS = new Set([
  'fishShed',
  'iceHouse',
  'warehouse',
  'packingHouse',
  'cooperage',
  'shed',
]);

function pick<T>(list: readonly T[], k: number): T {
  return list[((k % list.length) + list.length) % list.length] as T;
}

/** A small stable hash of a building id, for the choices the layout doesn't make. */
export function idHash(id: string): number {
  let h = 2166136261;
  for (let k = 0; k < id.length; k++) {
    h ^= id.charCodeAt(k);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
}

export function buildingStyle(b: Pick<DistrictBuilding, 'def'>): BuildingStyle {
  const def = b.def;
  const h = idHash(def.id);
  const brick = def.wall.startsWith('kit.wall_brick');
  const work = WORK_KINDS.has(def.kind);
  const house = def.kind === 'house';
  const front = def.roof === 'falseFront';
  const scheme = brick
    ? pick(CIVIC, def.paint)
    : house
      ? pick(HOUSE, def.paint + Math.floor(h * 3))
      : work
        ? pick(WORK, def.paint)
        : pick(SHOP, def.paint + (def.kind === 'saloon' ? 1 : 0));
  return {
    siding: brick ? 'brick' : work ? 'batten' : 'clapboard',
    ...scheme,
    shutters: house && h < 0.75,
    flowerBoxes: house && h > 0.35,
    curtains: !work,
    doorHood: house || def.kind === 'office',
    transom: !work,
    awning: front
      ? h < 0.5
        ? {
            kind: 'canvas',
            a: h < 0.25 ? 0xd9cfb4 : 0xc8bf9e,
            b: pick([0x8a3426, 0x2f4a3b, 0x3c4a6a], def.paint),
          }
        : { kind: 'plank', a: scheme.trim, b: scheme.roof }
      : undefined,
    cornice: front
      ? pick(['bracketed', 'pediment', 'stepped', 'plain'] as const, Math.floor(h * 4))
      : 'plain',
    ventilators:
      def.kind === 'iceHouse' || def.kind === 'fishShed'
        ? 1
        : def.kind === 'warehouse' && !brick
          ? def.wallHeightM > 8
            ? 0
            : 2
          : 0,
  };
}

/** Chimney tops a building has, district meters (for drawing and for their smoke). */
export interface Chimney {
  x: number;
  z: number;
  /** The base on the roof, and the top the smoke leaves. */
  y0: number;
  y1: number;
  /** A brick stack, or an iron stovepipe. */
  kind: 'brick' | 'pipe';
}

/** Which buildings keep a fire, and where its chimneys come up through the roof. */
export function chimneys(b: DistrictBuilding): Chimney[] {
  const def = b.def;
  const w = b.maxX - b.minX;
  const d = b.maxZ - b.minZ;
  const cx = (b.minX + b.maxX) / 2;
  const cz = (b.minZ + b.maxZ) / 2;
  const h = idHash(def.id);
  const rise = b.topY - b.eavesY;
  // A point on the roof `t` (−1..1) across the ridge: its height there.
  const at = (fx: number, fz: number, kind: Chimney['kind'], above: number): Chimney => {
    const x = cx + fx * w * 0.5;
    const z = cz + fz * d * 0.5;
    let y0: number;
    if (def.roof === 'gable') {
      const across = def.ridge === 'x' ? Math.abs(fz) : Math.abs(fx);
      y0 = b.eavesY + rise * (1 - across);
    } else if (def.roof === 'falseFront') {
      const gr = Math.min(Math.min(w, d) * 0.3, 3, rise - 0.15);
      const across = def.ridge === 'x' ? Math.abs(fz) : Math.abs(fx);
      y0 = b.eavesY + gr * (1 - across);
    } else y0 = b.eavesY + 0.3;
    return { x, z, y0: y0 - 0.3, y1: y0 + above, kind };
  };
  const side = h < 0.5 ? -1 : 1;
  switch (def.kind) {
    case 'house':
      return [
        at(
          def.ridge === 'x' ? side * 0.45 : 0.1,
          def.ridge === 'x' ? 0.1 : side * 0.45,
          'brick',
          1.2,
        ),
      ];
    case 'saloon':
      return [at(-0.5, 0.55, 'brick', 1.3), at(0.5, 0.2, 'pipe', 1.4)];
    case 'store':
    case 'chandlery':
      return [at(side * 0.5, 0.5, 'brick', 1.2)];
    case 'office':
      return [at(side * 0.35, 0, 'brick', 1.1)];
    case 'cooperage':
      return [at(0.25, 0.2, 'brick', 2.4), at(-0.3, -0.4, 'pipe', 1.4)];
    case 'fishShed':
    case 'shed':
      return h < 0.6 ? [at(side * 0.4, 0.3, 'pipe', 1.1)] : [];
    case 'lockup':
      return [at(0.3, 0.3, 'brick', 1.0)];
    case 'packingHouse':
      return [at(0.3, 0.6, 'brick', 2.6)];
    default:
      return [];
  }
}

/** A flag on a pole over the building: the harbor office, the police, the depot. */
export function flagpole(b: DistrictBuilding): { x: number; y: number; z: number } | undefined {
  const def = b.def;
  const flies =
    def.kind === 'office' &&
    (/harbor|police|depot/i.test(def.name ?? '') || def.id === 'union_depot');
  if (!flies && def.kind !== 'lockup') return undefined;
  const cx = (b.minX + b.maxX) / 2;
  const cz = (b.minZ + b.maxZ) / 2;
  if (def.roof === 'gable') {
    const w = b.maxX - b.minX;
    const d = b.maxZ - b.minZ;
    // On the ridge, toward one end.
    return def.ridge === 'x'
      ? { x: b.minX + Math.min(1.2, w * 0.2), y: b.topY, z: cz }
      : { x: cx, y: b.topY, z: b.minZ + Math.min(1.2, d * 0.2) };
  }
  return { x: b.minX + 0.8, y: b.topY + 0.2, z: b.minZ + 0.8 };
}
