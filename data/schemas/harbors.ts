import { z } from 'zod';
import { idOf } from './common';

/**
 * Harbor set pieces (plan 03 §3.4, R1a; Phase 2 piece G): the 1:1 waterfront built on a
 * set piece's footprint in data/zones.json. Positions are meters in the footprint's own
 * frame: `alongM` runs along the shore (positive to the right, facing out to sea from the
 * anchor) and `inlandM` back from the anchor (negative is out over the water).
 *
 * A pier starts on the shore: the runtime walks out from `inlandM` along the pier's bearing
 * to the waterline and builds `lengthM` of deck from there, so piers meet the real
 * shoreline wherever it is. Berths for auto-docking are at the outer end, one each side.
 *
 * A `canal` pier is different (Phase 3 piece I): one of the pair lining the Duluth Ship
 * Canal or Superior Entry. It runs exactly `lengthM` from `inlandM` (no walk: it crosses
 * the land and the water alike), and it has no berths: it is a wall to sail between.
 */

export const pierSchema = z.object({
  id: idOf('pier'),
  name: z.string().min(1),
  /**
   * City, fish, lumber and coal docks are plank piers on piles; an ore dock is a tall
   * timber trestle; a canal pier is a timber crib with a concrete cap, lining an entry.
   * A landing is a hideout's narrow plank stage on a few piles (Phase 4 piece E).
   */
  kind: z.enum(['city', 'fish', 'lumber', 'coal', 'ore', 'canal', 'landing']),
  alongM: z.number(),
  /** Where the walk out to the waterline starts, inland of the anchor. */
  inlandM: z.number().default(40),
  /** Degrees clockwise from north; defaults to the footprint's seaward bearing. */
  bearingDeg: z.number().min(0).max(360).optional(),
  /** Deck length from the waterline out, meters (1:1). */
  lengthM: z.number().positive(),
  widthM: z.number().positive(),
  /** Deck height above mean lake level; an ore dock's is the top of its pockets. */
  deckM: z.number().positive(),
});

export const buildingKindSchema = z.enum([
  'packingHouse',
  'cooperage',
  'sawmill',
  'warehouse',
  'store',
  'depot',
  'church',
  'fishShed',
  'house',
  /** Phase 3: the Twin Ports' grain elevators, tall enough to read from the lake. */
  'elevator',
  /** Phase 3: Superior's shipyard, a long building shed by the ways. */
  'shipShed',
  /** Phase 4 piece E, the Stockton stash: a fisherman's shack, its strongbox and a shed. */
  'shack',
  'strongbox',
  'storageShed',
]);

export const buildingSchema = z.object({
  kind: buildingKindSchema,
  name: z.string().optional(),
  alongM: z.number(),
  inlandM: z.number(),
  /** Size along the shore, back from it, and to the eaves, meters. */
  widthM: z.number().positive(),
  depthM: z.number().positive(),
  heightM: z.number().positive(),
  /** Turn from the footprint's axes, degrees. */
  yawDeg: z.number().default(0),
});

/** Houses scattered behind the waterfront: the town's silhouette and its lit windows. */
export const townSchema = z.object({
  houses: z.number().int().nonnegative(),
  alongM: z.tuple([z.number(), z.number()]),
  inlandM: z.tuple([z.number(), z.number()]),
  /** Highest ground a house stands on, meters above the lake. */
  maxGroundM: z.number().positive(),
  /** The most the ground may fall across a house, meters: more lets a town climb a hill. */
  maxStepM: z.number().positive().default(3.5),
  seed: z.number().int(),
});

export const harborSchema = z.object({
  id: idOf('harbor'),
  name: z.string().min(1),
  setPiece: idOf('setpiece'),
  piers: z.array(pierSchema).min(1),
  buildings: z.array(buildingSchema),
  town: townSchema,
});

export const harborsFileSchema = z.array(harborSchema);
export type HarborDef = z.infer<typeof harborSchema>;
export type PierDef = z.infer<typeof pierSchema>;
export type BuildingDef = z.infer<typeof buildingSchema>;
export type BuildingKind = z.infer<typeof buildingKindSchema>;
