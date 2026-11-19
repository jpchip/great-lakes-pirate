import { z } from 'zod';

/** Twelve monthly values, January first. */
const monthly = z.array(z.number().min(0).max(1)).length(12);
const range = z.tuple([z.number(), z.number()]);

/**
 * Winter's look (plan 04 §9, §11; plan 11 §18.4 piece L; `winter.json`): the snow on the
 * ground worked out a calendar day at a time over each winter's air (piece K's roll), and
 * the aurora's nights. Both are pure functions of the run's seed and the date, so nothing
 * here is saved.
 */
export const winterFileSchema = z.object({
  snow: z.object({
    /** A day's precipitation falls as snow when its mean air is under this, °C. */
    fallsBelowC: z.number(),
    /** The chance a calendar day brings snow (or rain, when warm), by month. */
    dayChance: monthly,
    /** A snow day's fall, cm of fresh snow (uniform in the range). */
    cmPerDay: range,
    /** Melt, cm of snow per °C·day above 0. */
    meltCm: z.number().nonnegative(),
    /** Snow on the ground settles by this share a day. */
    settle: z.number().min(0).max(1),
    /** This much snow covers the ground entirely, cm. */
    coverCm: z.number().positive(),
  }),
  aurora: z.object({
    /** The chance a night has the northern lights, by month (of the evening's date). */
    nightChance: monthly,
    /**
     * The sunspot cycle: chances peak at its maximum (cycle 14's, early 1906) and fall to
     * `minShare` of themselves at its minimum.
     */
    cycle: z.object({
      maxYear: z.number(),
      periodYears: z.number().positive(),
      minShare: z.number().min(0).max(1),
    }),
    /** A night's display: its strength, the hour it starts and how long it lasts. */
    strength: range,
    startHour: range,
    hours: range,
  }),
});
export type WinterFile = z.infer<typeof winterFileSchema>;
