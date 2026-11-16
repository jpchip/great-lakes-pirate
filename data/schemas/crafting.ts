import { z } from 'zod';
import { idOf } from './common';

/**
 * Hideout crafting (plan 09 §7, §12 `stations.json`, `recipes.json`; Phase 8 piece E).
 *
 * A **station** is a piece built at a hideout (`build.workbench` and the rest, whose
 * `functions.station` names it). A **recipe** turns goods and things from that hideout's
 * storage (and the hold of a ship moored there) into goods or things, over game time.
 * Most stations work while you wait, like a build session; a **passive** station (the
 * still) is loaded and left, and works on while you're away, one batch at a time, so a
 * week can never make more than its cap (plan 09 §7.3).
 *
 * A **thing** is anything made that isn't a good: a ship's store (`store.*`, kept in the
 * lockers once taken aboard), an upgrade (`upgrade.*`, installed at a slipway, piece G),
 * or an item from `items.json` (`item.*`: crates, barrels, the false-light rig). Things
 * take no CU, as the ship's stores don't (plan 10 §5).
 */

export const thingIdSchema = z
  .string()
  .regex(/^(store|upgrade|item)\.[a-z0-9_]+$/, 'Expected a store, upgrade or item id');

export const craftItemSchema = z.object({
  id: idOf('item'),
  name: z.string().min(1),
  blurb: z.string().min(1),
});

export const stationSchema = z.object({
  id: idOf('station'),
  name: z.string().min(1),
  /** The piece that is this station (its `functions.station` names this id). */
  piece: idOf('build'),
  blurb: z.string().min(1),
  /**
   * Works while you're away (plan 09 §7.3): loaded batches wait in its queue and run one
   * after another, so it never makes more than one batch per batch time.
   */
  passive: z.object({ queueMax: z.number().int().positive() }).optional(),
});

const goodsSchema = z.record(idOf('good'), z.number().int().positive());
const thingsSchema = z.record(thingIdSchema, z.number().int().positive());

export const recipeSchema = z
  .object({
    id: idOf('recipe'),
    name: z.string().min(1),
    station: idOf('station'),
    blurb: z.string().min(1),
    /** Game hours a batch takes, solo (a crew speeds an active station, not a still). */
    hours: z.number().positive(),
    inputs: z.object({
      goods: goodsSchema.optional(),
      things: thingsSchema.optional(),
      /** Needs a built well or rain barrel at the hideout. */
      water: z.boolean().optional(),
    }),
    output: z.object({
      goods: goodsSchema.optional(),
      things: thingsSchema.optional(),
    }),
    /**
     * Re-crating (plan 09 §7.1, plan 05 §6.1): each batch also takes one CU of a hot lot
     * and gives it back unmarked, its company marks gone.
     */
    recrate: z.boolean().optional(),
  })
  .refine((r) => r.recrate || r.output.goods || r.output.things, {
    message: 'A recipe makes something',
  });

export const itemsFileSchema = z.array(craftItemSchema);
export const stationsFileSchema = z.array(stationSchema);
export const recipesFileSchema = z.array(recipeSchema);
export type CraftItem = z.infer<typeof craftItemSchema>;
export type StationDef = z.infer<typeof stationSchema>;
export type RecipeDef = z.infer<typeof recipeSchema>;
