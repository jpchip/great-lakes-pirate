import { z } from 'zod';
import salvageJson from '../../data/salvage.json';
import { salvageFileSchema, type SalvageFile, type SalvageRules } from '../../data/schemas/salvage';
import type { Geo } from '../core/coords';
import { Rng } from '../core/rng';
import { calendarDate } from '../core/time';
import type { Wreck } from './wrecks';

/**
 * Salvage (plan 11 §6, §18.4 piece U). Pure: the old wrecks on the bottom (the record's and
 * a few invented each run), how one is found (seen on the bottom in clear, calm water by
 * day, or the lead line's spike as you pass over her), and the grapple and hook worked from
 * an anchored ship: a chance per cast, the time it takes, and what comes up. Old cargo comes
 * up sound or spoiled by its age and kind; a recent wreck gives what she carried, under her
 * owners' marks. Her papers, when they come up, are a clue for the journal's leads.
 *
 * The running game is `gameplay/salvage.ts`.
 */

let cached: SalvageFile | undefined;

export function salvageFile(): SalvageFile {
  cached ??= salvageFileSchema.parse(salvageJson);
  return cached;
}

export const SALVAGE_RULES: SalvageRules = salvageFile().rules;

export interface CargoLine {
  good: string;
  qty: number;
}

/** An old wreck on the bottom: one of the record's, or invented for this run. */
export interface OldWreck {
  id: string;
  name: string;
  classText: string;
  /** When she was lost, calendar ms (UTC). */
  lostMs: number;
  lostYear: number;
  at: Geo;
  where: string;
  /** Too deep for the grapple wherever she lies. */
  deep: boolean;
  /** A keeper's log charts her (piece O's logbooks). */
  logged: boolean;
  cargo: CargoLine[];
  papers?: { name: string; text: string; lead?: string | undefined } | undefined;
  curio?: string | undefined;
  lore: string;
  seeded: boolean;
}

function lostMsOf(date: string): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, d);
}

const seededCache = new Map<string, OldWreck[]>();

function fill(text: string, vars: Record<string, string>): string {
  return text.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? `{${k}}`);
}

/**
 * The old wrecks of a run: the record's (the *Lucerne* and R1's list), and `seeded.count`
 * invented ones at spots drawn by the seed (the same after a reload, different each run).
 * The seeded ones' papers name the next of them, so one leads to another.
 */
export function oldWrecks(seed: string, file: SalvageFile = salvageFile()): OldWreck[] {
  const key = file === salvageFile() ? seed : undefined;
  const hit = key !== undefined ? seededCache.get(key) : undefined;
  if (hit) return hit;
  const out: OldWreck[] = file.historical.map((h) => ({
    id: h.id,
    name: h.name,
    classText: h.classText,
    lostMs: lostMsOf(h.lost),
    lostYear: Number(h.lost.slice(0, 4)),
    at: { ...h.at },
    where: h.where,
    deep: !!h.deep,
    logged: !!h.logged,
    cargo: h.cargo.map((c) => ({ ...c })),
    papers: h.papers && { ...h.papers },
    curio: h.curio,
    lore: h.lore,
    seeded: false,
  }));
  const s = file.seeded;
  const rng = Rng.fromSeed(`${seed}|salvage`);
  const spots = shuffle(rng, s.spots).slice(0, Math.min(s.count, s.spots.length));
  const names = shuffle(rng, s.names);
  const made: OldWreck[] = spots.map((spot, i) => {
    const year = rng.int(s.years[0], s.years[1]);
    const classText = rng.pick(s.classes);
    const name = names[i % names.length] as string;
    const cargo = rng
      .pick(s.cargoes)
      .map((c) => ({ good: c.good, qty: rng.int(c.qty[0], c.qty[1]) }))
      .filter((c) => c.qty > 0);
    // Lost in the fall, when the gales come: October or November.
    const lostMs = Date.UTC(year, 9 + rng.int(0, 1), rng.int(1, 28));
    return {
      id: `wreck.old_${i + 1}`,
      name,
      classText,
      lostMs,
      lostYear: year,
      at: { ...spot.at },
      where: spot.where,
      deep: false,
      logged: false,
      cargo,
      curio: s.curios[i],
      lore: fill(s.lore, { classText, name, where: spot.where, year: String(year) }),
      seeded: true,
    };
  });
  made.forEach((w, i) => {
    const next = made[i + 1];
    w.papers = next
      ? {
          name: s.papers.name,
          text: fill(s.papers.other, { name: w.name, other: next.name, where: next.where }),
          lead: next.id,
        }
      : { name: s.papers.name, text: fill(s.papers.alone, { name: w.name }) };
  });
  out.push(...made);
  if (key !== undefined) seededCache.set(key, out);
  return out;
}

function shuffle<T>(rng: Rng, items: readonly T[]): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    [a[i], a[j]] = [a[j] as T, a[i] as T];
  }
  return a;
}

// --- State.

const cargoLineSchema = z.object({ good: z.string(), qty: z.number().int().positive() });

export const wreckProgressSchema = z.object({
  /** Sound CU brought up, by good. */
  raised: z.array(cargoLineSchema),
  /** CU that came up spoiled and went back over the side. */
  spoiled: z.array(cargoLineSchema),
  casts: z.number().int().nonnegative(),
  hooked: z.number().int().nonnegative(),
  /** When her papers came up; absent while they're still down there. */
  papersAt: z.number().optional(),
  /** When her curio came up. */
  curioAt: z.number().optional(),
  /** The last cast, game seconds. */
  lastAt: z.number(),
  /** The last time you were seen at her and the law heard (`crimeEveryHours`). */
  crimeAt: z.number().optional(),
});
export type WreckProgress = z.infer<typeof wreckProgressSchema>;

/** `state.salvage`: what's been taken from each wreck worked, by wreck id. */
export const salvageStateSchema = z.object({
  wrecks: z.record(z.string(), wreckProgressSchema),
});
export type SalvageState = z.infer<typeof salvageStateSchema>;

export function freshSalvage(): SalvageState {
  return { wrecks: {} };
}

export function progressOf(state: SalvageState, id: string, now: number): WreckProgress {
  return (state.wrecks[id] ??= { raised: [], spoiled: [], casts: 0, hooked: 0, lastAt: now });
}

function addLine(lines: CargoLine[], good: string, qty: number): void {
  if (qty <= 0) return;
  const l = lines.find((x) => x.good === good);
  if (l) l.qty += qty;
  else lines.push({ good, qty });
}

/** What's still in her: her cargo less what's come up, sound or spoiled. */
export function cargoLeft(
  cargo: readonly CargoLine[],
  p: Pick<WreckProgress, 'raised' | 'spoiled'> | undefined,
): CargoLine[] {
  const out: CargoLine[] = [];
  for (const c of cargo) {
    const gone =
      (p?.raised.find((x) => x.good === c.good)?.qty ?? 0) +
      (p?.spoiled.find((x) => x.good === c.good)?.qty ?? 0);
    addLine(out, c.good, c.qty - gone);
  }
  return out.filter((c) => c.qty > 0);
}

// --- Age and spoilage.

const DAY_MS = 86_400_000;

/** Calendar days she's lain on the bottom by game time `now`. */
export function ageDaysOld(lostMs: number, now: number): number {
  return Math.max(0, (calendarDate(now).getTime() - lostMs) / DAY_MS);
}

/** A wreck of this run: calendar days since she went down (a game day is a week). */
export function ageDaysRecent(sunkAt: number, now: number): number {
  return Math.max(0, (calendarDate(now).getTime() - calendarDate(sunkAt).getTime()) / DAY_MS);
}

/**
 * The share of a good's CU still sound after `ageDays` on the bottom: half gone every
 * `halfLifeDays` (flour in a month, salt in a week, hardware rusting over ten years); goods
 * without one keep (ore, coal, stone, copper, lumber, whiskey in the cask).
 */
export function soundShare(
  good: string,
  ageDays: number,
  halfLife: Readonly<Record<string, number>> = salvageFile().halfLifeDays,
): number {
  const h = halfLife[good];
  if (h === undefined) return 1;
  return Math.pow(0.5, Math.max(0, ageDays) / h);
}

// --- Finding her.

/**
 * Seen lying on the bottom from the deck (plan 11 §6.2: "Superior's water is very clear"):
 * by day, in a calm, in water no deeper than `sight.maxDepthM`, within `sight.rangeM` zone
 * meters (less the deeper she lies), and no further than the weather lets one see.
 */
export function seenOnBottom(
  rules: SalvageRules,
  c: { distM: number; depthM: number; hsM: number; daylight: number; visibilityM: number },
): boolean {
  const s = rules.sight;
  if (c.daylight < s.daylight || c.hsM > s.maxHsM || c.depthM > s.maxDepthM) return false;
  const range = s.rangeM * (1 - 0.5 * Math.max(0, c.depthM) / s.maxDepthM);
  return c.distM <= Math.min(range, c.visibilityM);
}

/** The lead line's spike over her: her hull's relief, meters, or 0 when she's not under you. */
export function depthSpike(rules: SalvageRules, distM: number): number {
  if (distM > rules.soundingM) return 0;
  // Highest over her middle, falling off to her ends.
  return rules.reliefM * (1 - 0.5 * (distM / rules.soundingM));
}

// --- The grapple and hook.

export interface CastConditions {
  depthM: number;
  hsM: number;
  daylight: number;
  /** Calendar years she's been down. */
  ageYears: number;
}

/** Why the grapple can't be worked here now, or undefined. */
export function castRefusal(
  rules: SalvageRules,
  c: { depthM: number; hsM: number; deep: boolean; holdFree: number; pickedClean: boolean },
): string | undefined {
  if (c.deep) return 'She lies far too deep for the grapple. A diving suit would reach her.';
  if (c.depthM > rules.maxDepthM) {
    return `She lies in ${Math.round(c.depthM)} m: too deep for the grapple. A diving suit would reach her.`;
  }
  if (c.pickedClean) return "There's nothing left in her worth the grapple: she's picked clean.";
  if (c.hsM > rules.maxHsM) return 'Too much sea running to work a grapple. Wait for a calm.';
  if (c.holdFree <= 0) return 'No room in the hold for anything she gives up.';
  return undefined;
}

/** The chance one cast hooks something worth bringing up. */
export function castChance(rules: SalvageRules, c: CastConditions): number {
  let p = rules.chance;
  const depth01 = Math.min(1, Math.max(0, c.depthM) / rules.maxDepthM);
  p *= 1 - (1 - rules.deepFactor) * depth01;
  const sea01 = Math.min(1, Math.max(0, c.hsM) / rules.maxHsM);
  p *= 1 - (1 - rules.seaFactor) * sea01;
  if (c.daylight < 0.5) p *= rules.nightFactor;
  if (c.ageYears >= rules.oldYears) p *= rules.oldFactor;
  return Math.max(0, Math.min(1, p));
}

/** What one wreck holds for the grapple. */
export interface SalvageTarget {
  id: string;
  cargo: readonly CargoLine[];
  /** Her papers are aboard (old wrecks with papers). */
  papers: boolean;
  curio?: string | undefined;
  /** Calendar days on the bottom. */
  ageDays: number;
}

export type CastResult =
  | { hooked: false }
  | { hooked: true; kind: 'cargo'; good: string; sound: number; spoiled: number }
  | { hooked: true; kind: 'papers' }
  | { hooked: true; kind: 'curio'; curio: string };

/** Nothing left in her: no cargo, her papers and curio up (or never there). */
export function pickedClean(t: SalvageTarget, p: WreckProgress | undefined): boolean {
  return (
    cargoLeft(t.cargo, p).length === 0 &&
    (!t.papers || p?.papersAt !== undefined) &&
    (!t.curio || p?.curioAt !== undefined)
  );
}

/**
 * One cast of the grapple. Hooked, it brings up her papers or her curio now and then while
 * they're down there (always once her cargo's gone), or `haulCu` CU of a good still in her,
 * picked by how much of each is left; each CU is sound by its good's share for her age,
 * the rest spoiled and over the side. At most `holdFree` sound CU come aboard (the haul is
 * cut to it). Records the cast in `p`.
 */
export function castGrapple(
  rules: SalvageRules,
  t: SalvageTarget,
  p: WreckProgress,
  chance: number,
  rng: Rng,
  holdFree: number,
  now: number,
): CastResult {
  p.casts++;
  p.lastAt = now;
  if (!rng.chance(chance)) return { hooked: false };
  const left = cargoLeft(t.cargo, p);
  const finds: ('papers' | 'curio')[] = [];
  if (t.papers && p.papersAt === undefined) finds.push('papers');
  if (t.curio && p.curioAt === undefined) finds.push('curio');
  if (finds.length && (left.length === 0 || rng.chance(rules.findChance))) {
    p.hooked++;
    const f = rng.pick(finds);
    if (f === 'papers') {
      p.papersAt = now;
      return { hooked: true, kind: 'papers' };
    }
    p.curioAt = now;
    return { hooked: true, kind: 'curio', curio: t.curio as string };
  }
  if (left.length === 0) return { hooked: false };
  p.hooked++;
  // Weighted by what's left of each.
  let total = 0;
  for (const l of left) total += l.qty;
  let r = rng.next() * total;
  let line = left[0] as CargoLine;
  for (const l of left) {
    r -= l.qty;
    if (r < 0) {
      line = l;
      break;
    }
  }
  const n = Math.min(line.qty, rng.int(rules.haulCu[0], Math.max(rules.haulCu[0], rules.haulCu[1])));
  const share = soundShare(line.good, t.ageDays);
  let sound = 0;
  let spoiled = 0;
  for (let i = 0; i < n; i++) {
    if (rng.chance(share)) sound++;
    else spoiled++;
  }
  // What won't fit stays in her for another cast.
  sound = Math.min(sound, Math.max(0, Math.floor(holdFree)));
  addLine(p.raised, line.good, sound);
  addLine(p.spoiled, line.good, spoiled);
  return { hooked: true, kind: 'cargo', good: line.good, sound, spoiled };
}

// --- A wreck of the run, and the law.

/** Whose a wreck of the run is, for the law (plan 11 §6.2). */
export type WreckClaim =
  /** Your own ship, lost: her cargo is yours. */
  | 'yours'
  /** One you sank, scuttled or put on a shoal: hot, and suspicious if you're seen at her. */
  | 'victim'
  /** The lake's: her owners' marks are on her cargo. */
  | 'owned'
  /** Nobody's mark on her (an ownerless wreck of the run). */
  | 'free';

export function wreckClaim(w: Pick<Wreck, 'how' | 'byPlayer' | 'owner'>): WreckClaim {
  if (w.byPlayer && w.how === 'abandoned') return 'yours';
  if (w.byPlayer) return 'victim';
  return w.owner ? 'owned' : 'free';
}
