import type { SiteDef } from '../../../data/schemas/sites';
import { calendarDate, SECONDS_PER_GAME_DAY } from '../../core/time';
import { seasonAt } from '../economy/defs';
import { sunAt } from '../weather/celestial';
import type { BuildGrid } from './grid';
import type { HideoutState, Hideouts } from './stash';
import { structure } from './structures';

/**
 * Hideout life (plan 09 §3, §6.2, §8; plan 06 §3.3, §5.4; Phase 8 piece F): the pure rules
 * behind sleeping in a bunk to lay low, a site's concealment and being spotted there, and
 * the salvage its ruins give a season. The running game is `gameplay/hideout-life.ts`.
 *
 * - **Laying low.** Asleep in a built bunk, the hideout's Wanted region cools `layLowFactor`
 *   times as fast as it would with you away (the law's tick takes the region). Tier 4's
 *   floor still holds: laying low is decay, not a reduction action (06 §3.3).
 * - **Concealment** (§8): the site's base, plus screens and shutters, less lamps lit after
 *   dark, chimney and still smoke, your ship lying in its anchorage, the size of the place
 *   and an upper floor. 0–1, shown in the build palette.
 * - **Spotted** (§8, §16.5): a ship under way that passes within sight of the site while
 *   your ship lies there or you're ashore in it ties you to the place. Sight shrinks with
 *   concealment, so a well-hidden camp is only seen from close aboard. Pursuers who watch
 *   you reach the anchorage spot it too. A spotted site is talked of in the saloons of its
 *   region and the next, and the *Morrill*'s sorties lean toward its region, for a week
 *   (one game day: a game day is a calendar week). Nothing ever raids it.
 * - **Salvage** (§6.2, §16.5): a site's ruins give a fixed stock a season (the Stockton
 *   quarry's dressed brownstone, the logging camp's lumber), carried away on foot one load
 *   at a time.
 */

// ---------------------------------------------------------------------------------
// Sleep

export type SleepUntil = 'dawn' | 'noon' | 'dusk' | 'eight';

/** The choices, in the order the dialog shows them. */
export const SLEEP_CHOICES: readonly [SleepUntil, string][] = [
  ['dawn', 'Until dawn'],
  ['noon', 'Until noon'],
  ['dusk', 'Until dusk'],
  ['eight', 'Eight hours'],
];

/** The shortest sleep: you lie down for an hour at least. */
const MIN_SLEEP_S = 3600;

/**
 * Seconds from `now` until the next waking hour: sunrise, noon, sunset, or eight hours on.
 * Always at least an hour and at most a day, so lying down at dawn for dawn sleeps round.
 */
export function sleepSeconds(until: SleepUntil, now: number): number {
  if (until === 'eight') return 8 * 3600;
  if (until === 'noon') {
    const into = ((now % SECONDS_PER_GAME_DAY) + SECONDS_PER_GAME_DAY) % SECONDS_PER_GAME_DAY;
    let s = 12 * 3600 - into;
    if (s < MIN_SLEEP_S) s += SECONDS_PER_GAME_DAY;
    return s;
  }
  const want = until === 'dawn';
  const up = (t: number): boolean => sunAt(t).elevationRad > 0;
  const step = 300;
  let was = up(now);
  for (let t = now + step; t <= now + SECONDS_PER_GAME_DAY + step; t += step) {
    const u = up(t);
    if (u === want && was !== want && t - now >= MIN_SLEEP_S) return t - now;
    was = u;
  }
  return SECONDS_PER_GAME_DAY;
}

/** "You slept until dawn (7 h 40 m)." */
export function sleepText(until: SleepUntil, seconds: number): string {
  const m = Math.round(seconds / 60);
  const span = m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} m` : ''}` : `${m} m`;
  if (until === 'eight') return `You slept eight hours.`;
  return `You slept until ${until} (${span}).`;
}

/** Built beds at a hideout (bunks). */
export function bedsOf(grid: BuildGrid): number {
  return grid.built().filter((p) => structure(p.piece.id).functions.bed).length;
}

// ---------------------------------------------------------------------------------
// Concealment

/** What the pieces and the moment do to a site's concealment, each a 0–1 delta. */
export interface ConcealmentPart {
  id: 'site' | 'cover' | 'lamps' | 'smoke' | 'ship' | 'size' | 'height';
  label: string;
  delta: number;
}

export interface Concealment {
  /** 0–1: higher is harder to spot. */
  value: number;
  /** "Well hidden", "Hidden", "Noticeable", "In plain sight". */
  word: string;
  parts: ConcealmentPart[];
}

export interface ConcealmentNow {
  /** After dark, when lamps show. */
  night: boolean;
  /** Your ship lies in its anchorage or alongside its pier. */
  shipHere: boolean;
}

/** Screens and shutters can hide a place only so much. */
export const COVER_CAP = 0.15;
/** Lamps and smoke together can give it away only so much more. */
export const SHOW_CAP = 0.3;
/** A ship lying at the site. */
export const SHIP_DELTA = -0.1;
/** An upper floor shows over the trees. */
export const HEIGHT_DELTA = -0.05;
/** Built pieces past this many make the place bigger than a fisherman's shack. */
export const SIZE_FREE = 60;
/** Each piece past that, up to `SIZE_CAP`. */
export const SIZE_PER_PIECE = 1 / 2000;
export const SIZE_CAP = 0.15;

export function concealmentWord(value: number): string {
  if (value >= 0.75) return 'Well hidden';
  if (value >= 0.5) return 'Hidden';
  if (value >= 0.3) return 'Noticeable';
  return 'In plain sight';
}

/** A site's concealment now (§8), with what makes it up. */
export function concealmentOf(site: SiteDef, grid: BuildGrid, now: ConcealmentNow): Concealment {
  let cover = 0;
  let lamps = 0;
  let smoke = 0;
  let upper = false;
  const built = grid.built();
  for (const p of built) {
    const def = structure(p.piece.id);
    const f = def.functions;
    // A roof on the ground floor's walls sits on level 1: only an upper storey counts.
    if (p.piece.level > 0 && def.placement !== 'roof' && !def.onRoof) upper = true;
    const d = f.concealment ?? 0;
    if (d > 0) cover += d;
    else if (d < 0) {
      // A chimney or a still smokes day and night; a lamp shows only after dark.
      if (f.smoke) smoke += d;
      else if (f.light && now.night) lamps += d;
    }
  }
  cover = Math.min(cover, COVER_CAP);
  const shown = lamps + smoke;
  if (shown < -SHOW_CAP) {
    const k = -SHOW_CAP / shown;
    lamps *= k;
    smoke *= k;
  }
  const size = -Math.min(SIZE_CAP, Math.max(0, built.length - SIZE_FREE) * SIZE_PER_PIECE);
  const parts: ConcealmentPart[] = [
    { id: 'site', label: 'The site', delta: site.concealment },
    { id: 'cover', label: 'Screens and shutters', delta: cover },
    { id: 'lamps', label: 'Lamps lit', delta: lamps },
    { id: 'smoke', label: 'Chimney smoke', delta: smoke },
    { id: 'ship', label: 'Your ship lying here', delta: now.shipHere ? SHIP_DELTA : 0 },
    { id: 'size', label: 'The size of the place', delta: size },
    { id: 'height', label: 'An upper floor', delta: upper ? HEIGHT_DELTA : 0 },
  ];
  const sum = parts.reduce((n, p) => n + p.delta, 0);
  const value = Math.min(1, Math.max(0, Math.round(sum * 100) / 100));
  return {
    value,
    word: concealmentWord(value),
    parts: parts.filter((p) => p.id === 'site' || Math.abs(p.delta) >= 0.005),
  };
}

// ---------------------------------------------------------------------------------
// Spotted

/** How far a passing ship's people see a site with no concealment at all, zone meters. */
export const SPOT_RANGE_M = 1600;
/** After dark a lookout sees less of the shore (lamps already count against the site). */
export const NIGHT_SPOT = 0.6;
/** How long a spotting is talked of and leans the cutter's patrol: a calendar week. */
export const SPOTTED_S = SECONDS_PER_GAME_DAY;

/** How close a passing ship must come to spot a site of this concealment, zone meters. */
export function spotRangeM(concealment: number, night: boolean): number {
  const c = Math.min(1, Math.max(0, concealment));
  return SPOT_RANGE_M * (1 - c) * (1 - c) * (night ? NIGHT_SPOT : 1);
}

/** Who spotted a hideout, when, and your ship's name then. */
export interface Spotted {
  at: number;
  /** The ship's name ("the tug Sophia"), or the law ship's id. */
  by: string;
  /** Your ship's name when you were seen there. */
  ship: string;
}

/** Spotted within the last week? */
export function spottedNow(h: Pick<HideoutState, 'spotted'>, now: number): boolean {
  return !!h.spotted && now - h.spotted.at < SPOTTED_S && now >= h.spotted.at;
}

/** The game time a site stops being talked of. */
export function spottedUntil(h: Pick<HideoutState, 'spotted'>): number | undefined {
  return h.spotted ? h.spotted.at + SPOTTED_S : undefined;
}

/** A site seen this recently isn't seen again: one pass, or one afternoon's traffic. */
export const SPOT_REPEAT_S = 6 * 3600;

/** Seen within `SPOT_REPEAT_S`: another sighting now adds nothing. */
export function recentlySpotted(h: Pick<HideoutState, 'spotted'>, now: number): boolean {
  return !!h.spotted && now >= h.spotted.at && now - h.spotted.at < SPOT_REPEAT_S;
}

/**
 * Marks a hideout spotted. Returns false (and changes nothing) when it was already spotted
 * within `SPOT_REPEAT_S`, so one pass doesn't spot it over and over.
 */
export function markSpotted(h: HideoutState, spotted: Spotted): boolean {
  if (recentlySpotted(h, spotted.at)) return false;
  h.spotted = { ...spotted };
  return true;
}

/** The Wanted regions holding a hideout spotted this week (the cutter's lean). */
export function spottedRegions(
  hideouts: Hideouts | undefined,
  sites: readonly SiteDef[],
  now: number,
): Set<string> {
  const out = new Set<string>();
  for (const h of Object.values(hideouts ?? {})) {
    if (!spottedNow(h, now)) continue;
    const site = sites.find((s) => s.id === h.siteId);
    if (site) out.add(site.wantedRegion);
  }
  return out;
}

// ---------------------------------------------------------------------------------
// Salvage

/** "1900-summer": the stock comes back each season. */
export function salvageSeason(now: number): string {
  return `${calendarDate(Math.max(0, now)).getUTCFullYear()}-${seasonAt(now)}`;
}

/** What's left of a site's salvage this season, CU. */
export function salvageLeft(
  site: SiteDef,
  h: Pick<HideoutState, 'salvage'> | undefined,
  now: number,
): number {
  const s = site.salvage;
  if (!s) return 0;
  const taken = h?.salvage && h.salvage.season === salvageSeason(now) ? h.salvage.taken : 0;
  return Math.max(0, s.perSeason - taken);
}

/**
 * Takes one load from a site's ruins: the CU lifted (the load, or what's left), or 0 when
 * the season's stock is gone. Salvage belongs to the hideout's claim: the stock is counted
 * on its state.
 */
export function takeSalvage(site: SiteDef, h: HideoutState, now: number): number {
  const s = site.salvage;
  if (!s) return 0;
  const left = salvageLeft(site, h, now);
  const n = Math.min(s.loadCu, left);
  if (n <= 0) return 0;
  const season = salvageSeason(now);
  const taken = h.salvage && h.salvage.season === season ? h.salvage.taken : 0;
  h.salvage = { season, taken: taken + n };
  return n;
}

/** Puts a load back on the pile it came from (you changed your mind at the pile). */
export function returnSalvage(h: HideoutState, qty: number, now: number): void {
  if (!h.salvage || h.salvage.season !== salvageSeason(now)) return;
  h.salvage.taken = Math.max(0, h.salvage.taken - qty);
}
