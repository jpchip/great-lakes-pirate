import { z } from 'zod';
import { idOf } from './common';

/**
 * Monthly climate for western Lake Superior (plan 04 §4.1, §24), one entry per month at
 * mid-month. The temperatures and the `observed` block are measurements; `sim` is the
 * weather sim's tuning, checked against `observed` by tests/climate.test.ts.
 *
 * Sources: air from the NOAA 1991–2020 normals for Madeline Island, WI (USC00474953);
 * water from the GLERL long-term daily mean surface temperature of Lake Superior
 * (glerlLTAvgTemp) on the 15th; wind from hourly NDBC observations at Devils Island
 * (DISW3), 2012–2023.
 */

const trackWeights = z.object({
  clipper: z.number().nonnegative(),
  panhandle: z.number().nonnegative(),
  pacific: z.number().nonnegative(),
});

export const climateMonthSchema = z.object({
  id: idOf('climate'),
  month: z.number().int().min(1).max(12),
  /** Normal daily high and low air temperature, °C. */
  airMaxC: z.number(),
  airMinC: z.number(),
  /** Lake surface temperature, °C. */
  waterC: z.number(),
  /** What the wind actually did, for checking the sim (not read by the game). */
  observed: z.object({
    /** Mean and 90th percentile hourly wind, knots. */
    meanWindKn: z.number().nonnegative(),
    p90WindKn: z.number().nonnegative(),
    /** Share of hours at or above 28 and 34 knots, percent. */
    over28KnPct: z.number().min(0).max(100),
    over34KnPct: z.number().min(0).max(100),
    /** The vector-mean wind: its speed in knots and where it comes from, degrees. */
    resultantKn: z.number().nonnegative(),
    resultantFromDeg: z.number().min(0).max(360),
  }),
  sim: z.object({
    /**
     * Background wind the moving systems ride on, knots, and where it comes from,
     * degrees clockwise from north. The systems add the rest.
     */
    prevailingKn: z.number().nonnegative(),
    prevailingFromDeg: z.number().min(0).max(360),
    /** New lows and highs per game day (a game day is a calendar week). */
    lowsPerDay: z.number().nonnegative(),
    highsPerDay: z.number().nonnegative(),
    /** Share of new lows that deepen into gales. */
    deepShare: z.number().min(0).max(1),
    /** Storm-track weights for new lows. */
    tracks: trackWeights,
    /** Advection fog (warm, moist air over cold water) and radiation fog weights, 0–1. */
    advectionFog: z.number().min(0).max(1),
    radiationFog: z.number().min(0).max(1),
  }),
});

export const climateFileSchema = z
  .array(climateMonthSchema)
  .length(12)
  .refine((months) => months.every((m, i) => m.month === i + 1), 'Months must run Jan…Dec');

export type ClimateMonth = z.infer<typeof climateMonthSchema>;
