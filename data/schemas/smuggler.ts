import { z } from 'zod';
import { idOf } from './common';

/**
 * Phase 4's one fence: the island smuggler (plan 05 §6.2–6.3, decision 1 of §16.6). A boat
 * that lies at an anchorage among the Apostles after dark, sells contraband by lantern
 * light and fences hot goods at 40–70% of their value out of a week's cash. One game day
 * is a calendar week (plan 04 §3.3), so "weekly" stock and cash come back every night.
 */
export const smugglerSchema = z.object({
  id: idOf('smuggler'),
  /** Her name, shown on the trade screen and the card. Fictional (plan 05 §10). */
  boatName: z.string().min(1),
  /** The ship class she's drawn as (ships.json, an NPC class). */
  classId: idOf('ship'),
  /** A line on who she is, under the name. */
  blurb: z.string().min(1),
  anchorage: z.object({
    id: idOf('anchorage'),
    /** "Oak Island's lee": the ledger and the rumors name it so. */
    name: z.string().min(1),
    /** "in the lee of Oak Island": how a rumor or a background puts it. */
    where: z.string().min(1),
    zone: idOf('zone'),
    /** The Wanted region the anchorage lies in (ports.json `wantedRegion`). */
    region: idOf('region'),
    at: z.object({ lat: z.number(), lon: z.number() }),
    /** Which way her bow lies at anchor, degrees clockwise from north. */
    headingDeg: z.number(),
  }),
  /**
   * After dark: she comes in when the sun is this far below the horizon (the end of civil
   * twilight is −6°) and is gone once it's back above it.
   */
  darkSunDeg: z.number().max(0),
  /** What she sells, each with a night's stock in CU. The price is the good's `smugglerPriceCents`. */
  sells: z.array(z.object({ good: idOf('good'), cu: z.number().int().positive() })).min(1),
  /** Her cash for buying from you, a night (a calendar week), integer cents. */
  weeklyCashCents: z.number().int().positive(),
  /**
   * The fence rate, as a share of a good's base value (plan 05 §6.2: 40–70%): `min`, plus
   * up to `trust` as your dealings with her add up to `trustAtCents`, plus up to `cool`
   * as a lot's heat cools. Contraband carries no heat, so it always gets the `cool` part.
   */
  rate: z.object({
    min: z.number().min(0).max(1),
    trust: z.number().min(0).max(1),
    cool: z.number().min(0).max(1),
    trustAtCents: z.number().int().positive(),
  }),
  /**
   * Backgrounds that start the run knowing where she lies (plan 05 §16.4 piece H), by the
   * save's `captain.background` id.
   */
  knownBy: z.array(z.string().min(1)),
});

export type Smuggler = z.infer<typeof smugglerSchema>;

/** Every smuggler; Phase 4 has one, the island smuggler. Later phases add the others. */
export const smugglersFileSchema = z.array(smugglerSchema).min(1);
