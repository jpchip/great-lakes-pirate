import { z } from 'zod';
import { geoSchema } from '../../data/schemas/zones';
import { calendarDate, dayAndHour, SECONDS_PER_GAME_DAY } from '../core/time';

/**
 * Wrecks (plan 07 §7.3; Phase 6 piece F). Every ship that goes to the bottom, by your hand
 * or the lake's, and your own when you abandon her, leaves a wreck site: where she lies
 * (on the chart, and in her zone when she went down in one, for the mast above water),
 * what she was and carried, how she went and who drowned. Salvage (plan 11) and wreck
 * investigations (plan 06 §6.2) read these later; for now they're a chart mark, a mast or
 * a debris field in the world, and a line in the ledger.
 */

export const WRECK_HOWS = ['sunk', 'scuttled', 'foundered', 'abandoned'] as const;
export type WreckHow = (typeof WRECK_HOWS)[number];

export const wreckSchema = z.object({
  id: z.string(),
  /** The traffic ship's id she sailed under (for the timetable and the papers). */
  shipId: z.string(),
  name: z.string(),
  classId: z.string(),
  owner: z.string().optional(),
  how: z.enum(WRECK_HOWS),
  /** You sank her (or she was yours). */
  byPlayer: z.boolean(),
  at: geoSchema,
  /** In a zone, where she lies in its meters (her mast stands there). */
  zone: z.object({ id: z.string(), x: z.number(), z: z.number() }).optional(),
  region: z.string().optional(),
  sunkAt: z.number(),
  /** Hands who went down with her or drowned from her boat. */
  drowned: z.number().int().nonnegative(),
  /** What's still in her hold, for plan 11's salvage. */
  cargo: z.array(z.object({ good: z.string(), qty: z.number().positive() })),
  /** The ledger's line. */
  lore: z.string(),
});
export type Wreck = z.infer<typeof wreckSchema>;

export const wrecksSchema = z.object({
  nextId: z.number().int().positive(),
  list: z.array(wreckSchema),
});
export type WrecksState = z.infer<typeof wrecksSchema>;

/** The lake keeps this many wrecks on the chart; the oldest drop off it (the save stays small). */
export const WRECKS_MAX = 40;

export function freshWrecks(): WrecksState {
  return { nextId: 1, list: [] };
}

export interface WreckInput {
  shipId: string;
  name: string;
  classId: string;
  className: string;
  owner?: string | undefined;
  ownerName?: string | undefined;
  how: WreckHow;
  byPlayer: boolean;
  at: { lat: number; lon: number };
  zone?: { id: string; x: number; z: number } | undefined;
  region?: string | undefined;
  regionName?: string | undefined;
  now: number;
  drowned: number;
  cargo: readonly { good: string; qty: number }[];
}

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** "June 4, 1900" (as the end screen's dates; kept here so the save schema imports little). */
function dateText(gameSeconds: number): string {
  const d = calendarDate(dayAndHour(gameSeconds).day * SECONDS_PER_GAME_DAY);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

const HOW_WORDS: Record<WreckHow, string> = {
  sunk: 'sunk by gunfire',
  scuttled: 'scuttled',
  foundered: 'foundered',
  abandoned: 'abandoned and foundered',
};

/** "The fish tug Ada Bell (Hollister Fish & Packing Co.), scuttled in the Apostle Islands…" */
export function wreckLore(w: WreckInput): string {
  const owner = w.ownerName ? ` (${w.ownerName})` : '';
  const where = w.regionName ? ` in ${w.regionName}` : '';
  const fate =
    w.drowned > 0
      ? ` ${w.drowned} ${w.drowned === 1 ? 'hand' : 'hands'} lost with her.`
      : ' All hands got off.';
  const cargo = w.cargo.length > 0 ? ' Her hold went down full.' : '';
  return `The ${w.className.toLowerCase()} ${w.name}${owner}, ${HOW_WORDS[w.how]}${where}, ${dateText(w.now)}.${fate}${cargo}`;
}

/** Records a wreck; the oldest past `WRECKS_MAX` drop off. */
export function recordWreck(state: WrecksState, w: WreckInput): Wreck {
  const wreck: Wreck = {
    id: `wreck-${state.nextId++}`,
    shipId: w.shipId,
    name: w.name,
    classId: w.classId,
    ...(w.owner ? { owner: w.owner } : {}),
    how: w.how,
    byPlayer: w.byPlayer,
    at: { lat: w.at.lat, lon: w.at.lon },
    ...(w.zone ? { zone: { ...w.zone } } : {}),
    ...(w.region ? { region: w.region } : {}),
    sunkAt: w.now,
    drowned: Math.max(0, Math.round(w.drowned)),
    cargo: w.cargo.filter((c) => c.qty > 0).map((c) => ({ good: c.good, qty: c.qty })),
    lore: wreckLore(w),
  };
  state.list.push(wreck);
  if (state.list.length > WRECKS_MAX) state.list.splice(0, state.list.length - WRECKS_MAX);
  return wreck;
}

/** The wrecks lying in a zone (their masts stand above the water there). */
export function wrecksIn(state: WrecksState | undefined, zoneId: string): Wreck[] {
  return (state?.list ?? []).filter((w) => w.zone?.id === zoneId);
}
