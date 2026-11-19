import { z } from 'zod';
import type { NicknameDeedDef, NicknameForm, NicknamesDef } from '../../../data/schemas/newspapers';
import { Rng } from '../../core/rng';

/**
 * Your nickname (plan 12 §6.3; Phase 9 piece B). Once your Fame reaches tier 1 the papers
 * coin one from your record: the deeds they've named you for, each counted and weighed by
 * how notorious it is (`notoriety` in `newspapers.json`), so the most frequent and the most
 * notorious lead; and your haunt, the place you're most seen at. The name follows your
 * record: another deed or another haunt that clearly overtakes the old one (by
 * `switchMargin`) gives a new name. You can't pick it, but a letter to the editor rerolls
 * it once: the same record read another way.
 *
 * All of it is plain state: the save's `nickname` slice is optional, so a run from before
 * it starts with no name and an empty record.
 */

export const nicknameStateSchema = z.object({
  /** The name the papers print, once coined. */
  current: z.string().optional(),
  /** The deed it was coined from (a deed id, or `fallback`), and the haunt (a place key). */
  deed: z.string().optional(),
  haunt: z.string().optional(),
  coinedAt: z.number().optional(),
  /** The paper that coined it (its id). */
  paper: z.string().optional(),
  /** The one letter to the editor has been written. */
  rerolled: z.boolean().default(false),
  /** Bumped by the letter: the same record, another name. */
  salt: z.number().int().nonnegative().default(0),
  /** Deeds the papers named you for, by crime id (`feat` for an honest feat). */
  deeds: z.record(z.string(), z.number().nonnegative()).default({}),
  /** Lives the papers know you took. */
  killed: z.number().int().nonnegative().default(0),
  /** Where you're seen, by place key (`port.bayfield`, `site.stockton`): a weighed count. */
  places: z.record(z.string(), z.number().nonnegative()).default({}),
  /** Crimes already counted (two reports of one crime count once); the newest kept. */
  counted: z.array(z.string()).default([]),
  /** The names you've had, oldest first. */
  history: z.array(z.object({ name: z.string(), at: z.number() })).default([]),
});
export type NicknameState = z.infer<typeof nicknameStateSchema>;

const COUNTED_MAX = 40;
const HISTORY_MAX = 8;

export function freshNickname(): NicknameState {
  return {
    rerolled: false,
    salt: 0,
    deeds: {},
    killed: 0,
    places: {},
    counted: [],
    history: [],
  };
}

/** A deed the papers named you for. False when that crime was counted already. */
export function noteDeed(
  state: NicknameState,
  deed: string,
  opts: { crimeId?: string | undefined; killed?: number | undefined } = {},
): boolean {
  if (opts.crimeId) {
    if (state.counted.includes(opts.crimeId)) return false;
    state.counted.push(opts.crimeId);
    if (state.counted.length > COUNTED_MAX)
      state.counted.splice(0, state.counted.length - COUNTED_MAX);
  }
  state.deeds[deed] = (state.deeds[deed] ?? 0) + 1;
  if (opts.killed) state.killed += opts.killed;
  return true;
}

export function notePlace(state: NicknameState, place: string, weight: number): void {
  if (weight <= 0) return;
  state.places[place] = (state.places[place] ?? 0) + weight;
}

/** A deed kind's score: each of its crimes the papers named you for, times its notoriety. */
export function deedScore(def: NicknameDeedDef, state: NicknameState): number {
  if (def.noKilling && state.killed > 0) return 0;
  let n = def.feats ? (state.deeds['feat'] ?? 0) : 0;
  for (const c of def.crimes) n += state.deeds[c] ?? 0;
  return n * def.notoriety;
}

/** Every deed kind with a score, best first (ties to the more notorious). */
export function deedScores(
  defs: NicknamesDef,
  state: NicknameState,
): { id: string; score: number }[] {
  return defs.deeds
    .map((d) => ({ id: d.id, score: deedScore(d, state), notoriety: d.notoriety }))
    .filter((d) => d.score > 0)
    .sort((a, b) => b.score - a.score || b.notoriety - a.notoriety)
    .map(({ id, score }) => ({ id, score }));
}

/**
 * The deed the name stands on: the best scored, unless the one it was coined from still
 * holds within the margin (so a name doesn't flicker between two close records).
 */
export function leadingDeed(defs: NicknamesDef, state: NicknameState): string {
  const scores = deedScores(defs, state);
  const best = scores[0];
  if (!best) return 'fallback';
  const held = state.deed && scores.find((s) => s.id === state.deed);
  if (held && best.score < held.score * defs.switchMargin) return held.id;
  return best.id;
}

/** Your haunt: the place you're most seen at, past the least score, held within the margin. */
export function leadingHaunt(defs: NicknamesDef, state: NicknameState): string | undefined {
  const places = Object.entries(state.places)
    .filter(([, v]) => v >= defs.haunt.min)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const best = places[0];
  if (!best) return undefined;
  const held = state.haunt !== undefined ? state.places[state.haunt] : undefined;
  if (held !== undefined && held >= defs.haunt.min && best[1] < held * defs.haunt.margin) {
    return state.haunt;
  }
  return best[0];
}

/** "Ida Bergquist": Ida and Bergquist. One name serves for both. */
export function captainNames(captain: string): { first: string; last: string } {
  const parts = captain.trim().split(/\s+/).filter(Boolean);
  const first = parts[0] ?? captain;
  return { first, last: parts[parts.length - 1] ?? first };
}

export interface NameInput {
  deed: string;
  /** The haunt's name ("Stockton Island", "Bayfield"), if you have one. */
  haunt: string | undefined;
  captain: string;
  seed: string;
  salt: number;
}

function formsFor(defs: NicknamesDef, deed: string): readonly NicknameForm[] {
  return defs.deeds.find((d) => d.id === deed)?.names ?? defs.fallback;
}

function render(form: NicknameForm, captain: string, haunt: string | undefined): string {
  const { first, last } = captainNames(captain);
  const text = form.form
    .replace(/\{first\}/g, first)
    .replace(/\{last\}/g, last)
    .replace(/\{haunt\}/g, haunt ?? '');
  return form.ofHaunt && haunt ? `${text} of ${haunt}` : text;
}

/** The forms that can be used: one naming the haunt needs one. */
function usable(forms: readonly NicknameForm[], haunt: string | undefined): NicknameForm[] {
  return forms.filter((f) => haunt !== undefined || !f.form.includes('{haunt}'));
}

/** The name for a record: a form of its deed's pool, chosen by the run's seed and the salt. */
export function nameFor(defs: NicknamesDef, input: NameInput): string {
  let forms = usable(formsFor(defs, input.deed), input.haunt);
  if (forms.length === 0) forms = usable(defs.fallback, input.haunt);
  const rng = Rng.fromSeed(`${input.seed}|nickname|${input.deed}|${input.salt}`);
  const form = forms[Math.floor(rng.next() * forms.length)] ?? forms[0];
  return form ? render(form, input.captain, input.haunt) : input.captain;
}

export interface NicknameWorld {
  fameTier: number;
  captain: string;
  seed: string;
  /** A place key's name: "Bayfield", "Stockton Island". */
  placeName(place: string): string | undefined;
}

export interface NicknameChange {
  from: string | undefined;
  to: string;
}

function adopt(state: NicknameState, name: string, now: number): void {
  state.current = name;
  state.history.push({ name, at: now });
  if (state.history.length > HISTORY_MAX)
    state.history.splice(0, state.history.length - HISTORY_MAX);
}

/**
 * Reads the record again: coins the name at the Fame tier, or changes it when the leading
 * deed or the haunt has changed. Returns the change, or undefined.
 */
export function reviewNickname(
  defs: NicknamesDef,
  state: NicknameState,
  world: NicknameWorld,
  now: number,
): NicknameChange | undefined {
  if (!state.current && world.fameTier < defs.fromFameTier) return undefined;
  const deed = leadingDeed(defs, state);
  const haunt = leadingHaunt(defs, state);
  if (state.current && deed === state.deed && haunt === state.haunt) return undefined;
  const name = nameFor(defs, {
    deed,
    haunt: haunt ? world.placeName(haunt) : undefined,
    captain: world.captain,
    seed: world.seed,
    salt: state.salt,
  });
  const from = state.current;
  state.deed = deed;
  state.haunt = haunt;
  if (name === from) return undefined;
  if (!from) state.coinedAt = now;
  adopt(state, name, now);
  return { from, to: name };
}

/**
 * The letter to the editor (once a run): the same record read another way. A refusal, or
 * the change.
 */
export function rerollNickname(
  defs: NicknamesDef,
  state: NicknameState,
  world: NicknameWorld,
  now: number,
): NicknameChange | string {
  if (!state.current) return 'The papers have no name for you yet.';
  if (state.rerolled) return 'The editor printed one letter from you. He will not print another.';
  const from = state.current;
  const deed = state.deed ?? leadingDeed(defs, state);
  const haunt = state.haunt ? world.placeName(state.haunt) : undefined;
  state.rerolled = true;
  for (let i = 0; i < 16; i++) {
    state.salt += 1;
    const name = nameFor(defs, {
      deed,
      haunt,
      captain: world.captain,
      seed: world.seed,
      salt: state.salt,
    });
    if (name !== from) {
      adopt(state, name, now);
      return { from, to: name };
    }
  }
  // A pool of one: the fallback's names stand in.
  const name = nameFor(defs, {
    deed: 'fallback',
    haunt,
    captain: world.captain,
    seed: world.seed,
    salt: state.salt,
  });
  if (name === from) return 'The editor printed your letter, and went on calling you the same.';
  adopt(state, name, now);
  return { from, to: name };
}
