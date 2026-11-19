import { z } from 'zod';
import { idOf } from './common';

/**
 * The lake's ice (plan 04 §4.2, §8; plan 11 §18.4 piece K; `ice.json`). The ice is worked
 * out each calendar day of a winter from freezing and thawing degree-days, for a set of
 * shelter classes from the open lake (0) to the most sheltered, shallow bay (1); every
 * place on the chart has a shelter from its depth and its distance from shore, raised in
 * the basins and harbors named here. Each winter rolls its severity (colder or milder than
 * the normals) and its fall storms from the run's seed.
 */

const lonLat = z.tuple([z.number(), z.number()]);

export const iceFileSchema = z.object({
  /** The year's roll (plan 04 §4.2). */
  year: z.object({
    /** Degrees C colder for each unit of severity, December to March. */
    severityC: z.number().positive(),
    /** Severity is drawn in [-max, max] (a sum of uniforms: most winters near 0). */
    severityMax: z.number().positive(),
    /** The day-to-day anomaly's spread, °C, and how much of yesterday's it keeps. */
    anomalyC: z.number().nonnegative(),
    anomalyKeep: z.number().min(0).max(0.99),
    /** Fall storms: gales' share is the normals' times a draw in this range, Oct–Dec. */
    fallStorms: z.tuple([z.number().positive(), z.number().positive()]),
  }),
  /** The degree-day model. */
  growth: z.object({
    /** The cooling (°C·days below 0, less a share of the warm days) open water needs first. */
    coolShelteredFdd: z.number().nonnegative(),
    coolOpenFdd: z.number().positive(),
    /** How fast the need falls off from open to sheltered: (1 − shelter)^power. */
    coolPower: z.number().positive(),
    /** Share of each warm day's degrees taken back off the cooling. */
    warmBack: z.number().min(0),
    /** Stefan's law: thickness cm = coeff × √(°C·days of freezing). */
    stefanCm: z.number().positive(),
    /** Melt, cm per °C·day above 0. */
    meltCm: z.number().nonnegative(),
    /** The thickness at which the ice covers its water, cm. */
    coverCm: z.number().positive(),
    /** Below this shelter the ice is pack, drifting with the wind; above, fast to the shore. */
    packBelow: z.number().min(0).max(1),
    /** Pack ice never closes the open lake entirely: its most coverage. */
    packMaxCoverage: z.number().min(0).max(1),
    /** Spring breakup: on or after this month and day, once the ice is thinner than this. */
    breakup: z.object({
      month: z.number().int().min(0).max(11),
      day: z.number().int().min(1).max(31),
      underCm: z.number().positive(),
      /** Calendar days for broken ice to clear, by shelter: open lake, sheltered bay. */
      clearDays: z.tuple([z.number().positive(), z.number().positive()]),
    }),
  }),
  /** What ice does to a hull (plan 02 §5.2, plan 10 §5.1). */
  hull: z.object({
    /** Ice this thick, closed over its water, stops a plain hull; the ice bow takes more. */
    stopCm: z.number().positive(),
    stopCoverage: z.number().min(0).max(1),
    /** The worst drag in ice she can still make way through, and in floes. */
    drag: z.number().min(0).max(1),
    floeDrag: z.number().min(0).max(1),
    /** Hull HP a real second per knot over `damageFromKn`, in full cover at `stopCm`. */
    damagePerKn: z.number().nonnegative(),
    damageFromKn: z.number().nonnegative(),
    /** Floes knock at the hull too: HP per knot over `floeFromKn` in full floes. */
    floeDamagePerKn: z.number().nonnegative(),
    floeFromKn: z.number().nonnegative(),
  }),
  /** A harbor is closed (frozen in) at this coverage and thickness, open again under `openCoverage`. */
  harbor: z.object({
    closedCoverage: z.number().min(0).max(1),
    closedCm: z.number().positive(),
    openCoverage: z.number().min(0).max(1),
  }),
  /** The shelter field: chart cells this size, and how depth and shore make it. */
  field: z.object({
    cellM: z.number().positive(),
    /** Shelter from depth: 1 at the shore, falling to 0 by this many fathoms (log scale). */
    deepFathoms: z.number().positive(),
    /** Shelter from shore distance: e^(−d / shoreM). */
    shoreM: z.number().positive(),
    /** Weights of the two, summing to at most 1. */
    depthWeight: z.number().min(0).max(1),
    shoreWeight: z.number().min(0).max(1),
  }),
  /** Enclosed bays that freeze first, whatever their depth. */
  basins: z.array(
    z.object({
      id: idOf('basin'),
      name: z.string().min(1),
      shelter: z.number().min(0).max(1),
      ring: z.array(lonLat).min(3),
    }),
  ),
  /** Each port's harbor: its shelter, and how far out it reaches, meters. */
  harbors: z.record(
    idOf('port'),
    z.object({ shelter: z.number().min(0).max(1), radiusM: z.number().positive() }),
  ),
  /** The first-boat-in race (plan 05 §3, plan 12 §5.2): the port, and the premium. */
  firstBoat: z.object({
    port: idOf('port'),
    /** Its market buys at this multiple for the first boat's cargo. */
    premium: z.number().min(1),
  }),
  /** The Mataafa storm (plan 04 §18, plan 12 §5.2): November 27–28, 1905. */
  mataafa: z.object({
    /** UTC calendar date-time the storm is at its height over the western lake. */
    peak: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/),
    /** Its depth, hPa below standard, and radius, km. */
    peakHpa: z.number().positive(),
    radiusKm: z.number().positive(),
  }),
});
export type IceFile = z.infer<typeof iceFileSchema>;
