import { z } from 'zod';
import { idOf } from './common';
import { heistTargetSchema } from './heist';

/**
 * Docks districts (plan 08 §2, §13, §15; Phase 7 piece C): the modular kit, the district
 * index and the layout files the dev placement editor writes.
 *
 * The grid is plan 09 §4's: 2 m cells, 3 m levels, four rotations, and three kinds of
 * placement. A **cell** piece fills one cell (pier decks, wharves, floors, track). An
 * **edge** piece stands on a cell's edge (walls, doors, windows, fences, railings). A
 * **prop** is placed freely on a 0.25 m sub-grid with 15° turns (crates, lamps, carts).
 * Buildings are rectangles of cells with walls round the edge and a roof made for them;
 * their perimeter edges can be swapped for doors and windows.
 */

/**
 * What the ground or deck is made of underfoot, for footstep noise (plan 08 §3.2): wooden
 * piers ring louder than dirt alleys. The on-foot `Surface` type; terrain gets one from the zone.
 */
export const surfaceSchema = z.enum([
  'wood',
  'stone',
  'dirt',
  'grass',
  'sand',
  'rock',
  'gravel',
  'sawdust',
]);
export type Surface = z.infer<typeof surfaceSchema>;

export const kitPlacementSchema = z.enum(['cell', 'edge', 'prop']);

/**
 * How a piece collides and how guards and the player read it.
 * - `deck`: a walkable platform on piles (a pier or wharf cell) at `deckM`.
 * - `floor`: a walkable floor a step above the ground.
 * - `flat`: nothing to collide with (track, a painted sign), only a surface.
 * - `wall`, `window`: a full-height wall on the edge; a window shows lamplight.
 * - `door`: a wall with an opening (`openingM` wide, 2.2 m tall) guards path through.
 * - `fence`, `rail`: a barrier you can see over (a rail) or not (a board fence).
 * - `solid`: a prop's box (`sizeM`, `heightM`); `round` makes it a cylinder.
 * - `post`: a thin pole (a lamp post), `sizeM[0]` across.
 * - `none`: decoration only.
 */
export const kitColliderSchema = z.enum([
  'deck',
  'floor',
  'flat',
  'wall',
  'window',
  'door',
  'fence',
  'rail',
  'solid',
  'post',
  'none',
]);

export const kitLightSchema = z.object({
  /** Light reaches zero at this distance, meters (plan 08 §4.1 pools). */
  radiusM: z.number().positive(),
  /** 0–1: a gas lamp is 1, a lantern on a hook less. */
  intensity: z.number().min(0).max(2),
  /** Hex color, `#rrggbb`. */
  color: z.string().regex(/^#[0-9a-f]{6}$/),
  /** The flame's height above the piece's base, meters. */
  heightM: z.number().nonnegative(),
});

export const kitPieceSchema = z.object({
  id: idOf('kit'),
  name: z.string().min(1),
  placement: kitPlacementSchema,
  /** The editor palette groups pieces by this. */
  category: z.enum([
    'pier',
    'ground',
    'wall',
    'fence',
    'cargo',
    'yard',
    'furniture',
    'light',
    'marine',
    'backdrop',
  ]),
  collider: kitColliderSchema,
  /** Footprint, meters: a prop's width (x) and depth (z). Cells and edges ignore it. */
  sizeM: z.tuple([z.number().positive(), z.number().positive()]).default([1, 1]),
  /** Height above its base, meters: a wall's, a crate's, a lamp post's. */
  heightM: z.number().nonnegative(),
  /** A deck's height above the lake, meters (`deck` pieces). */
  deckM: z.number().positive().optional(),
  /** A door or gate's clear width, meters. */
  openingM: z.number().positive().optional(),
  /** Round props collide as a cylinder of diameter `sizeM[0]`. */
  round: z.boolean().default(false),
  surface: surfaceSchema.optional(),
  light: kitLightSchema.optional(),
  /** Blocks a guard's line of sight (plan 08 §4.1 occlusion rays); rails and posts don't. */
  blocksSight: z.boolean().default(true),
  /** A marked climb (plan 08 §3.1, §19 finding 3): a vault over, or a ladder up or down. */
  climb: z.enum(['vault', 'ladder']).optional(),
});
export type KitPiece = z.infer<typeof kitPieceSchema>;

export const kitFileSchema = z.array(kitPieceSchema);

/** The building kinds the kit dresses: which roof and wall trim, and the sign over the door. */
export const districtBuildingKindSchema = z.enum([
  'warehouse',
  'packingHouse',
  'cooperage',
  'fishShed',
  'iceHouse',
  'saloon',
  'office',
  'chandlery',
  'store',
  'lockup',
  'shed',
  'house',
]);

/** A port-screen tab a shop door opens by day (plan 08 §20.6 decision 3). */
export const portTabSchema = z.enum(['market', 'chandlery', 'ledger', 'contracts', 'backRoom']);

/** A building: a rectangle of cells with walls round it and a roof over it. */
export const districtBuildingSchema = z.object({
  /** Unique in the district: `hollister_warehouse`. Doors are `<id>.door<n>`. */
  id: z.string().regex(/^[a-z0-9_]+$/),
  name: z.string().min(1).optional(),
  kind: districtBuildingKindSchema,
  col: z.number().int(),
  row: z.number().int(),
  cols: z.number().int().min(1),
  rows: z.number().int().min(1),
  /** The wall piece used round the edge where no override is set. */
  wall: idOf('kit'),
  /** The floor piece laid in every cell. */
  floor: idOf('kit'),
  /** Eaves above the floor, meters. */
  wallHeightM: z.number().min(2.4).max(12),
  roof: z.enum(['gable', 'flat', 'falseFront']),
  /** Which way the ridge runs: along x (the shore) or z (inland). */
  ridge: z.enum(['x', 'z']).default('x'),
  /** Index into the kit's house paints. */
  paint: z.number().int().nonnegative().default(0),
  opens: portTabSchema.optional(),
  /**
   * Perimeter overrides: `[piece, side, index]`. Side 0 is the north (-z) wall, 1 east,
   * 2 south, 3 west; `index` counts cells along that side from its west or north end.
   * A piece of `kit.none` leaves the edge open.
   */
  edges: z.array(z.tuple([idOf('kit'), z.number().int().min(0).max(3), z.number().int().min(0)])),
});
export type DistrictBuildingDef = z.infer<typeof districtBuildingSchema>;

/**
 * Named spots for the systems that come after the kit: where you step ashore, where a
 * ship is moored, guard posts and patrol points (piece D), loot (piece E), the exits.
 */
export const districtMarkSchema = z.object({
  id: z.string().regex(/^[a-z0-9_.]+$/),
  kind: z.enum(['gangway', 'berth', 'post', 'patrol', 'loot', 'exit', 'crowd']),
  x: z.number(),
  z: z.number(),
  /** Degrees clockwise from north (-z). */
  headingDeg: z.number().default(0),
  /** A building this mark belongs to, or the route it is on. */
  ref: z.string().optional(),
});
export type DistrictMark = z.infer<typeof districtMarkSchema>;

/**
 * A district layout (`data/districts/<id>.json`), as the dev placement editor saves it.
 * Pieces are packed as tuples over a palette of kit ids, like plan 09 §10's hideout saves:
 * - cells `[palette, col, row, variant]`
 * - edges `[palette, col, row, side, variant]` (side 0 north, 1 east, 2 south, 3 west)
 * - props `[palette, x, z, yawDeg, variant]` (x and z on a 0.25 m grid, yaw in 15° steps)
 *
 * Local meters: x along the shore (to the right, facing the lake), z inland, so the lake is
 * toward -z and a heading of 0 faces it. The district's origin sits on its harbor's set
 * piece at `origin` (districts.json).
 */
export const districtLayoutSchema = z.object({
  id: idOf('district'),
  version: z.literal(1),
  cellM: z.literal(2),
  bounds: z.object({
    x0: z.number(),
    z0: z.number(),
    cols: z.number().int().positive(),
    rows: z.number().int().positive(),
  }),
  palette: z.array(idOf('kit')),
  cells: z.array(z.tuple([z.number().int(), z.number().int(), z.number().int(), z.number().int()])),
  edges: z.array(
    z.tuple([
      z.number().int(),
      z.number().int(),
      z.number().int(),
      z.number().int().min(0).max(3),
      z.number().int(),
    ]),
  ),
  props: z.array(z.tuple([z.number().int(), z.number(), z.number(), z.number(), z.number().int()])),
  buildings: z.array(districtBuildingSchema),
  marks: z.array(districtMarkSchema),
});
export type DistrictLayoutFile = z.infer<typeof districtLayoutSchema>;

/** One entry of data/districts.json (plan 08 §15). */
export const districtDefSchema = z.object({
  id: idOf('district'),
  name: z.string().min(1),
  port: idOf('port'),
  harbor: idOf('harbor'),
  /** The layout file under data/districts/. */
  layout: z.string().regex(/^[a-z0-9_]+\.json$/),
  /** The baked ground and navmesh under public/districts/<dir>/. */
  bake: z.string().regex(/^[a-z0-9_]+$/),
  /** Where the layout's origin sits in the harbor footprint's frame (harbors.json). */
  origin: z.object({ alongM: z.number(), inlandM: z.number() }),
  /** Meters baked around the walkable bounds for the ground you see past them. */
  skirtM: z.number().nonnegative().default(40),
  /** The lake surface on foot. */
  waterLevelM: z.number().default(0),
  /** The mark you step ashore at from a berth (piece A). */
  gangway: z.string(),
  /** The buildings worth breaking into, their locks, owners and containers (piece E). */
  targets: z.array(heistTargetSchema).default([]),
});
export type DistrictDef = z.infer<typeof districtDefSchema>;

export const districtsFileSchema = z.array(districtDefSchema);
