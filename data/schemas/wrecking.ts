import { z } from 'zod';
import { idOf } from './common';

/**
 * Wrecking, "moon cussing" (plan 06 §6.2, plan 11 §18.4 piece I; `wrecking.json`). The
 * marks are the headlands and shoal edges in the Apostles where a false light can be hung:
 * each sits beside a traffic lane, near a light the lane's captains steer by, with a shoal
 * between the lane and the shore. A ship that takes the rig's light for the real one turns
 * in for it and strands on the shoal, or in a gale breaks up there.
 *
 * The rules weigh how likely that is: the light used (a false light, or a real one doused),
 * how dark the night is, the weather, and the captain. A clear night and an alert captain
 * mostly see through it; a moonless gale in fog takes nearly anyone.
 */

const geo = z.object({ lat: z.number(), lon: z.number() });
const range = z.tuple([z.number().min(0), z.number().min(0)]);

export const wreckingMarkSchema = z.object({
  id: idOf('mark'),
  /** "Sand Island shoal". */
  name: z.string().min(1),
  /** The light the lane's captains steer by here: the false light passes for it. */
  light: idOf('light'),
  /** Where the rig is set: the headland, or the shoal's edge. */
  rig: geo,
  /** Where a misled ship strands: shallow water between the lane and the rig. */
  shoal: geo,
  /** The shoal's danger, 0–1: how hard a ship that turns in for the light goes on. */
  danger: z.number().min(0).max(1),
  /** One line on the place, for the prompt and the papers. */
  blurb: z.string().min(1),
});
export type WreckingMark = z.infer<typeof wreckingMarkSchema>;

export const wreckingRulesSchema = z.object({
  /** The rig burns this many game hours at most (its kerosene), and goes out at dawn. */
  rigHours: z.number().positive(),
  /** Zone meters from the rig's spot a rig can be set from your deck or your boat. */
  setRangeM: z.number().positive(),
  /** A ship within this many real nautical miles of the shoal is passing the mark. */
  passNm: z.number().positive(),
  /** The base chance a passing ship is fooled, before the night, weather and captain. */
  chance: z.object({ falseLight: z.number().min(0).max(1), doused: z.number().min(0).max(1) }),
  /** Both at once (the real light dark and a false one lit): the false light's, times this. */
  bothFactor: z.number().min(1),
  /** The sun must be this far below the horizon, degrees, for a light to fool anyone. */
  nightSunDeg: z.number(),
  /** How much a full moon high in a clear sky spoils it (its factor at full light). */
  moonFactor: z.number().min(0).max(1),
  weather: z.object({
    /** The factor on a clear, quiet night. */
    clear: z.number().min(0).max(1),
    /** Visibility under this, meters, is thick: the factor is 1. */
    thickVisM: z.number().positive(),
    /** A fresh breeze and up: `fresh`. A gale: 1. */
    freshKn: z.number().positive(),
    fresh: z.number().min(0).max(1),
    galeKn: z.number().positive(),
  }),
  /** A doused light alone fools nobody on a clear night: only in weather this bad (0–1). */
  dousedNeedsWeather: z.number().min(0).max(1),
  /** The captain's alertness factor, from the sharpest to the sloppiest. */
  captain: range,
  /** The chance a fooled ship breaks up rather than strands, by the wind at the mark. */
  breakUp: z.object({ fromKn: z.number().positive(), atGaleChance: z.number().min(0).max(1) }),
  /** Share of her crew drowned: stranded, and broken up. */
  drowned: z.object({ stranded: range, broken: range }),
  /** Game days she lies stranded, to be boarded, before her owners' tug pulls her off. */
  strandedDays: z.number().positive(),
  /** Game days she's then off her timetable for repairs (a broken ship: `brokenDays`). */
  repairDays: z.number().positive(),
  brokenDays: z.number().positive(),
  /** The keeper of the mark's light sees the false light: the chance, within this range. */
  keeper: z.object({ chance: z.number().min(0).max(1), rangeNm: z.number().positive() }),
  /** Your ship is put to the wreck when she's within this many zone meters of the mark. */
  nearM: z.number().positive(),
  /**
   * Pattern detection (plan 06 §6.2): this many strandings near one light within
   * `withinDays` game days opens an investigation, which adds `heat` in the light's region
   * and orders the cutter there for `days`.
   */
  investigation: z.object({
    wrecks: z.number().int().positive(),
    withinDays: z.number().positive(),
    heat: z.number().positive(),
    days: z.number().positive(),
  }),
  /** The moon-cussing night (12 §5.2): the moon's lit share at most, and how far ahead a ship is due. */
  moonCussing: z.object({ maxIllumination: z.number().min(0).max(1), withinHours: z.number() }),
});
export type WreckingRules = z.infer<typeof wreckingRulesSchema>;

export const wreckingFileSchema = z.object({
  rules: wreckingRulesSchema,
  marks: z.array(wreckingMarkSchema).min(1),
});
export type WreckingFile = z.infer<typeof wreckingFileSchema>;
