import { z } from 'zod';
import rivalsJson from '../../../data/rival_templates.json';
import {
  RIVAL_METHODS,
  RIVAL_PERSONALITIES,
  rivalTemplatesSchema,
  type PersonalityDef,
  type RivalCampDef,
  type RivalMethod,
  type RivalMethodDef,
  type RivalPersonality,
  type RivalTemplates,
} from '../../../data/schemas/rivals';
import { SECONDS_PER_GAME_DAY } from '../../core/time';
import type { Geo } from '../../core/coords';
import { geoDistanceM } from '../discovery/discovery';

/**
 * Copycat rivals (plan 12 §7, plan 07 §8.1; plan 11 §18.4 piece E). Pure functions on the
 * saved `rivals` record; `gameplay/rivals.ts` feeds them your crimes, Fame and the clock,
 * sails each rival as a traffic ship on its lane, sends its raids through the law's crime
 * pipeline and fires each beat's sandbox event.
 *
 * - **Your record:** every crime of yours counts to its method (boarding, the guns,
 *   sinking, wrecking, smuggling, burglary) and its region, halving over
 *   `recordHalfLifeDays`. A rival copies the shape of it.
 * - **Emergence:** none until your Fame reaches `emergeFameTier` (Known); then, after
 *   `emergeAfterDays` at the tier and `againDays` since the last, one appears, up to
 *   `maxByFameTier` at once. Their lane runs through the region where you rob most, their
 *   personality leans to the methods you use, and their camp is one of the island
 *   anchorages, never near a hideout site.
 * - **Raids:** every `raidDays` or so, by a method drawn from theirs.
 * - **Blame:** a raid is put to "a schooner" (you) at `blame.onYou` times your share of its
 *   method; your crime is put to a rival in its region at `blame.onThem` times theirs.
 * - **Leaving:** caught by the law (their notoriety), lost in a gale, retired once your
 *   Fame has fallen, or beaten by you (Fame and a lead to their stash).
 * - **Parley:** settled a while, they may write proposing a truce (no blame either way) or a
 *   split of the lake (they take a lane elsewhere), met in a saloon; they may keep it or
 *   break it, and you may sell them to the constable instead.
 *
 * Optional in the save (plan 12 §10 `rivals[]`): a run from before it has had none.
 */

export const RIVALS: RivalTemplates = rivalTemplatesSchema.parse(rivalsJson);

const DAY = SECONDS_PER_GAME_DAY;

export const RIVAL_STATUSES = ['active', 'caught', 'lost', 'retired', 'defeated'] as const;
export type RivalStatus = (typeof RIVAL_STATUSES)[number];

export const PARLEY_STAGES = [
  'offered',
  'meeting',
  'declined',
  'stood_up',
  'refused',
  'truce',
  'split',
  'sold',
  'betrayed',
] as const;
export type ParleyStage = (typeof PARLEY_STAGES)[number];

const methodRecord = z.partialRecord(z.enum(RIVAL_METHODS), z.number().nonnegative());
export type MethodShares = Partial<Record<RivalMethod, number>>;

export const rivalSchema = z.object({
  /** `rival.<n>`, unique in the run. */
  id: z.string(),
  /** Which of the three ships at sea she is (1–3): her chart contact. */
  slot: z.number().int().min(1).max(3),
  first: z.string(),
  last: z.string(),
  nick: z.string(),
  personality: z.enum(RIVAL_PERSONALITIES),
  classId: z.string(),
  shipName: z.string(),
  /** The route lane she hunts on, and the Wanted region she's reckoned to. */
  lane: z.string(),
  region: z.string(),
  camp: z.string(),
  methods: methodRecord,
  emergedAt: z.number(),
  nextRaidAt: z.number(),
  raids: z.number().int().nonnegative(),
  /** Their own notoriety with the law. */
  heat: z.number().nonnegative(),
  /** What's in their stash: cash and goods (the Copycat's Hoard, piece T). */
  stash: z.object({
    cents: z.number().int().nonnegative(),
    goods: z.array(z.object({ good: z.string(), qty: z.number().int().positive() })),
  }),
  status: z.enum(RIVAL_STATUSES),
  endedAt: z.number().optional(),
  /** Beaten: struck and taken, or sunk. */
  how: z.enum(['taken', 'sunk']).optional(),
  parley: z
    .object({
      stage: z.enum(PARLEY_STAGES),
      at: z.number(),
      kind: z.enum(['truce', 'split']).optional(),
      /** The saloon they wait in. */
      port: z.string().optional(),
      /** They'll break it, and when it shows. */
      betrays: z.boolean().optional(),
      betrayAt: z.number().optional(),
      /** Split: the lane and region they gave up. */
      homeLane: z.string().optional(),
      homeRegion: z.string().optional(),
    })
    .optional(),
});
export type Rival = z.infer<typeof rivalSchema>;

export const rivalsStateSchema = z.object({
  nextId: z.number().int().positive(),
  list: z.array(rivalSchema),
  /** Your record: crimes by method and by region, decaying, as of `at`. */
  record: z.object({
    methods: methodRecord,
    regions: z.record(z.string(), z.number().nonnegative()),
    at: z.number(),
  }),
  /** Since when your Fame has stood at `emergeFameTier` or above. */
  tierSince: z.number().optional(),
  /** Since when it has stood below (they start to retire). */
  lowSince: z.number().optional(),
  lastEmergedAt: z.number().optional(),
});
export type RivalsState = z.infer<typeof rivalsStateSchema>;

/** Rivals gone are kept for the journal and the papers, the latest this many. */
export const KEEP_GONE = 12;

export function createRivalsState(now: number): RivalsState {
  return { nextId: 1, list: [], record: { methods: {}, regions: {}, at: now } };
}

export function personalityOf(r: Pick<Rival, 'personality'>, defs = RIVALS): PersonalityDef {
  const p = defs.personalities.find((d) => d.id === r.personality);
  if (!p) throw new Error(`No personality ${r.personality}`);
  return p;
}

export function methodDef(m: RivalMethod, defs = RIVALS): RivalMethodDef {
  const d = defs.methods.find((x) => x.id === m);
  if (!d) throw new Error(`No method ${m}`);
  return d;
}

export function campOf(r: Pick<Rival, 'camp'>, defs = RIVALS): RivalCampDef | undefined {
  return defs.camps.find((c) => c.id === r.camp);
}

/** The method a crime counts to, if any. */
export function methodOfCrime(crime: string, defs = RIVALS): RivalMethod | undefined {
  return defs.methods.find((m) => m.crimes.includes(crime))?.id;
}

export function activeRivals(state: RivalsState | undefined): Rival[] {
  return (state?.list ?? []).filter((r) => r.status === 'active');
}

/** "Patrick 'Red Hand' Rourke". */
export function rivalName(r: Pick<Rival, 'first' | 'last' | 'nick'>): string {
  return `${r.first} '${r.nick}' ${r.last}`;
}

// --- Your record.

function decay(state: RivalsState, now: number, defs: RivalTemplates): void {
  const rec = state.record;
  const dt = now - rec.at;
  if (dt <= 0) return;
  const k = Math.pow(0.5, dt / (defs.rules.recordHalfLifeDays * DAY));
  for (const m of RIVAL_METHODS) {
    const v = rec.methods[m];
    if (v !== undefined) rec.methods[m] = v * k;
  }
  for (const [region, v] of Object.entries(rec.regions)) rec.regions[region] = v * k;
  rec.at = now;
}

/** A crime of yours: counted to its method and its region. Returns its method. */
export function noteYourCrime(
  state: RivalsState,
  crime: string,
  region: string,
  now: number,
  defs = RIVALS,
): RivalMethod | undefined {
  const m = methodOfCrime(crime, defs);
  if (!m) return undefined;
  decay(state, now, defs);
  state.record.methods[m] = (state.record.methods[m] ?? 0) + 1;
  state.record.regions[region] = (state.record.regions[region] ?? 0) + 1;
  return m;
}

/** Shares summing to 1 (all 0 when there's nothing). */
export function normalize(s: MethodShares): Record<RivalMethod, number> {
  let total = 0;
  for (const m of RIVAL_METHODS) total += s[m] ?? 0;
  const out = {} as Record<RivalMethod, number>;
  for (const m of RIVAL_METHODS) out[m] = total > 0 ? (s[m] ?? 0) / total : 0;
  return out;
}

/** Your methods as shares of your record. */
export function yourShares(state: RivalsState): Record<RivalMethod, number> {
  return normalize(state.record.methods);
}

/** Where you rob most, if you've robbed anywhere. */
export function yourTopRegion(state: RivalsState): string | undefined {
  let best: string | undefined;
  let bestV = 0;
  for (const [r, v] of Object.entries(state.record.regions)) {
    if (v > bestV) {
      best = r;
      bestV = v;
    }
  }
  return best;
}

/** How alike two sets of methods are, 0–1 (the overlap of their shares). */
export function similarity(a: MethodShares, b: MethodShares): number {
  const x = normalize(a);
  const y = normalize(b);
  let s = 0;
  for (const m of RIVAL_METHODS) s += Math.min(x[m], y[m]);
  return s;
}

// --- Emergence.

/** At most this many at once at a Fame tier. */
export function maxRivals(fameTier: number, defs = RIVALS): number {
  const t = defs.rules.maxByFameTier;
  return t[Math.min(Math.max(0, fameTier), t.length - 1)] ?? 0;
}

/** Keeps the clocks on your Fame: how long at the tier, or how long below it. */
export function trackFame(state: RivalsState, fameTier: number, now: number, defs = RIVALS): void {
  if (fameTier >= defs.rules.emergeFameTier) {
    state.tierSince ??= now;
    delete state.lowSince;
  } else {
    delete state.tierSince;
    state.lowSince ??= now;
  }
}

/** Is a new rival due? */
export function canEmerge(
  state: RivalsState,
  fameTier: number,
  now: number,
  defs = RIVALS,
): boolean {
  const r = defs.rules;
  if (fameTier < r.emergeFameTier) return false;
  if (activeRivals(state).length >= maxRivals(fameTier, defs)) return false;
  if (state.tierSince === undefined || now - state.tierSince < r.emergeAfterDays * DAY) {
    return false;
  }
  return state.lastEmergedAt === undefined || now - state.lastEmergedAt >= r.againDays * DAY;
}

/** A lane a rival can hunt on: its id, the regions it runs through and its middle. */
export interface HuntingLane {
  id: string;
  regions: readonly string[];
  mid: Geo;
}

export interface EmergeWorld {
  now: number;
  /** The lanes with prizes on them (trade and fishing). */
  lanes: readonly HuntingLane[];
  /** Your ship's tier (plan 10). */
  playerTier: number;
  /** Your hideout sites and any others to keep clear of, as geo points. */
  keepClear: readonly Geo[];
  /** Where you are, for a newcomer when you've no record yet. */
  hereRegion: string | undefined;
}

export type Rand = () => number;

function pick<T>(items: readonly T[], rand: Rand): T | undefined {
  if (items.length === 0) return undefined;
  return items[Math.floor(rand() * items.length) % items.length];
}

function weighted<T>(items: readonly { item: T; w: number }[], rand: Rand): T | undefined {
  const total = items.reduce((s, x) => s + Math.max(0, x.w), 0);
  if (total <= 0) return items[0]?.item;
  let u = rand() * total;
  for (const x of items) {
    u -= Math.max(0, x.w);
    if (u < 0) return x.item;
  }
  return items[items.length - 1]?.item;
}

/** The camps no hideout site is near: `keepClearM` from every one. */
export function clearCamps(keepClear: readonly Geo[], defs = RIVALS): RivalCampDef[] {
  const avoid = [...keepClear, ...defs.avoid.map((a) => a.at)];
  return defs.camps.filter((c) =>
    avoid.every((g) => geoDistanceM(c.at, g) >= defs.rules.keepClearM),
  );
}

/**
 * A new rival from the templates: a personality leaning to your methods, methods copied
 * from yours, a lane through the region you rob most, the nearest clear camp to it and a
 * ship a tier at most below yours. Undefined when there's no free slot, lane or camp.
 */
export function emergeRival(
  state: RivalsState,
  world: EmergeWorld,
  rand: Rand,
  defs = RIVALS,
): Rival | undefined {
  const active = activeRivals(state);
  const slot = [1, 2, 3].find((s) => !active.some((r) => r.slot === s));
  if (slot === undefined) return undefined;
  decay(state, world.now, defs);
  const yours = yourShares(state);

  const personality = weighted(
    defs.personalities.map((p) => {
      const lean = normalize(p.lean);
      let fit = 0;
      for (const m of RIVAL_METHODS) fit += yours[m] * lean[m];
      return { item: p, w: 1 + 3 * fit };
    }),
    rand,
  ) as PersonalityDef;

  const lean = normalize(personality.lean);
  const anyRecord = RIVAL_METHODS.some((m) => yours[m] > 0);
  const k = anyRecord ? defs.rules.copyShare : 0;
  const methods: MethodShares = {};
  for (const m of RIVAL_METHODS) {
    const v = k * yours[m] + (1 - k) * lean[m];
    if (v > 0) methods[m] = Math.round(v * 1000) / 1000;
  }

  const region = yourTopRegion(state) ?? world.hereRegion;
  const taken = new Set(active.map((r) => r.lane));
  const inRegion = world.lanes.filter((l) => region && l.regions.includes(region));
  const pool = [
    inRegion.filter((l) => !taken.has(l.id)),
    inRegion,
    world.lanes.filter((l) => !taken.has(l.id)),
    world.lanes,
  ].find((p) => p.length > 0);
  const lane = pool && pick(pool, rand);
  if (!lane) return undefined;

  const usedCamps = new Set(active.map((r) => r.camp));
  const camps = clearCamps(world.keepClear, defs);
  const free = camps.filter((c) => !usedCamps.has(c.id));
  const near = (free.length ? free : camps)
    .slice()
    .sort((a, b) => geoDistanceM(a.at, lane.mid) - geoDistanceM(b.at, lane.mid));
  // One of the two nearest, so the same lane doesn't always get the same camp.
  const camp = pick(near.slice(0, 2), rand);
  if (!camp) return undefined;

  const top = Math.max(...defs.ships.map((s) => s.tier));
  const tier = Math.max(1, Math.min(top, world.playerTier - (rand() < 0.5 ? 1 : 0)));
  const shipDef =
    defs.ships.filter((s) => s.tier <= tier).sort((a, b) => b.tier - a.tier)[0] ?? defs.ships[0];
  if (!shipDef) return undefined;
  const usedShips = new Set(state.list.map((r) => r.shipName));
  const shipName =
    pick(
      shipDef.names.filter((n) => !usedShips.has(n)),
      rand,
    ) ?? (pick(shipDef.names, rand) as string);

  const usedFirst = new Set(active.map((r) => r.first));
  const usedLast = new Set(state.list.map((r) => r.last));
  const usedNick = new Set(state.list.map((r) => r.nick));
  const first =
    pick(
      defs.names.first.filter((n) => !usedFirst.has(n)),
      rand,
    ) ?? (pick(defs.names.first, rand) as string);
  const last =
    pick(
      defs.names.last.filter((n) => !usedLast.has(n)),
      rand,
    ) ?? (pick(defs.names.last, rand) as string);
  const nick =
    pick(
      personality.nicknames.filter((n) => !usedNick.has(n)),
      rand,
    ) ?? (pick(personality.nicknames, rand) as string);

  const rival: Rival = {
    id: `rival.${state.nextId++}`,
    slot,
    first,
    last,
    nick,
    personality: personality.id,
    classId: shipDef.classId,
    shipName,
    lane: lane.id,
    region: region && lane.regions.includes(region) ? region : (lane.regions[0] ?? ''),
    camp: camp.id,
    methods,
    emergedAt: world.now,
    // The first raid comes soon: they're new to it and keen.
    nextRaidAt: world.now + personality.raidDays * DAY * (0.2 + 0.3 * rand()),
    raids: 0,
    heat: 0,
    stash: { cents: 0, goods: [] },
    status: 'active',
  };
  state.list.push(rival);
  state.lastEmergedAt = world.now;
  return rival;
}

// --- Raids.

/** A raid's method, drawn from theirs. */
export function raidMethod(r: Rival, rand: Rand): RivalMethod {
  const items = RIVAL_METHODS.map((m) => ({ item: m, w: r.methods[m] ?? 0 }));
  return weighted(items, rand) ?? 'boarding';
}

/** Is their next raid due? */
export function raidDue(r: Rival, now: number): boolean {
  return r.status === 'active' && now >= r.nextRaidAt;
}

/** Nothing to rob this time: they try again in a few hours. */
export function raidLater(r: Rival, now: number, rand: Rand): void {
  r.nextRaidAt = now + (4 + 8 * rand()) * 3600;
}

/**
 * A raid done: counted, their notoriety up by its heat, the haul to the stash, and the next
 * one set by their pace.
 */
export function noteRaid(
  r: Rival,
  heat: number,
  haul: { cents: number; goods: readonly { good: string; qty: number }[] },
  now: number,
  rand: Rand,
  defs = RIVALS,
): void {
  const p = personalityOf(r, defs);
  r.raids += 1;
  r.heat += heat * p.heatFactor;
  r.stash.cents += Math.max(0, Math.round(haul.cents));
  for (const g of haul.goods) {
    const qty = Math.round(g.qty);
    if (qty <= 0) continue;
    const have = r.stash.goods.find((x) => x.good === g.good);
    if (have) have.qty += qty;
    else r.stash.goods.push({ good: g.good, qty });
  }
  r.nextRaidAt = now + p.raidDays * DAY * (0.6 + 0.8 * rand());
}

/** A truce stands: no blame either way. */
export function inTruce(r: Rival): boolean {
  return r.parley?.stage === 'truce';
}

/**
 * Does the crew of a rival's raid say "a schooner" (laid at your door) rather than
 * "persons unknown"? The more of your work is by its method, the likelier.
 */
export function pinnedOnYou(
  state: RivalsState,
  r: Rival,
  method: RivalMethod,
  rand: Rand,
  defs = RIVALS,
): boolean {
  if (inTruce(r)) return false;
  return rand() < defs.rules.blame.onYou * yourShares(state)[method];
}

/**
 * The rival a crime of yours is put down to, if any: one active in its region, at
 * `blame.onThem` times their share of its method (the likeliest of them, when two are).
 */
export function blameRival(
  state: RivalsState,
  crime: string,
  region: string,
  rand: Rand,
  defs = RIVALS,
): Rival | undefined {
  const m = methodOfCrime(crime, defs);
  if (!m) return undefined;
  const candidates = activeRivals(state)
    .filter((r) => r.region === region && !inTruce(r))
    .map((r) => ({ r, share: normalize(r.methods)[m] }))
    .filter((x) => x.share > 0)
    .sort((a, b) => b.share - a.share);
  const best = candidates[0];
  if (!best) return undefined;
  return rand() < defs.rules.blame.onThem * best.share ? best.r : undefined;
}

// --- Leaving.

export type LeaveHow = 'caught' | 'lost' | 'retired';

export interface LeaveWorld {
  now: number;
  /** The game hours since the last check. */
  hours: number;
  /** The storm signal flies in their region. */
  gale: boolean;
}

/**
 * How a rival leaves this hour, if they do: the law (their notoriety), a gale, or none.
 * Their notoriety cools as the hours go. Retirement is `retiring`'s, by your Fame.
 */
export function leaveCheck(
  r: Rival,
  w: LeaveWorld,
  rand: Rand,
  defs = RIVALS,
): LeaveHow | undefined {
  if (r.status !== 'active' || w.hours <= 0) return undefined;
  const c = defs.rules.caught;
  r.heat *= Math.pow(1 - c.decayPerDay, w.hours / 24);
  const daily = Math.min(c.max, c.base + r.heat * c.perHeat);
  if (rand() < 1 - Math.pow(1 - daily, w.hours / 24)) return 'caught';
  if (w.gale && rand() < 1 - Math.pow(1 - defs.rules.galeLossPerHour, w.hours)) return 'lost';
  return undefined;
}

/**
 * The rival who retires now, your Fame having stood below `emergeFameTier` long enough
 * (the one longest at it first); the clock starts again for the next.
 */
export function retiring(state: RivalsState, now: number, defs = RIVALS): Rival | undefined {
  if (state.lowSince === undefined) return undefined;
  if (now - state.lowSince < defs.rules.retireAfterDays * DAY) return undefined;
  const r = activeRivals(state).sort((a, b) => a.emergedAt - b.emergedAt)[0];
  if (r) state.lowSince = now;
  return r;
}

/** They're gone: caught, lost, retired or beaten. Older gone ones are let go. */
export function endRival(
  state: RivalsState,
  r: Rival,
  status: Exclude<RivalStatus, 'active'>,
  now: number,
  how?: 'taken' | 'sunk',
): void {
  if (r.status !== 'active') return;
  r.status = status;
  r.endedAt = now;
  if (how) r.how = how;
  const gone = state.list.filter((x) => x.status !== 'active');
  if (gone.length > KEEP_GONE) {
    const drop = new Set(
      gone
        .sort((a, b) => (a.endedAt ?? 0) - (b.endedAt ?? 0))
        .slice(0, gone.length - KEEP_GONE)
        .map((x) => x.id),
    );
    state.list = state.list.filter((x) => !drop.has(x.id));
  }
}

// --- Parley.

/** Do they write proposing a parley this hour? Once a rival, after `afterDays` settled. */
export function parleyDue(
  r: Rival,
  now: number,
  hours: number,
  rand: Rand,
  defs = RIVALS,
): boolean {
  if (r.status !== 'active' || r.parley) return false;
  if (now - r.emergedAt < defs.rules.parley.afterDays * DAY) return false;
  const daily = personalityOf(r, defs).parley;
  return rand() < 1 - Math.pow(1 - daily, hours / 24);
}

/** What they propose. */
export function proposalOf(r: Rival, defs = RIVALS): 'truce' | 'split' {
  return personalityOf(r, defs).proposes;
}

/** The saloon they'll meet you in: their region's. */
export function parleyPort(r: Rival, defs = RIVALS): string {
  return defs.rules.parley.ports[r.region] ?? 'port.bayfield';
}

export function offerParley(r: Rival, now: number, defs = RIVALS): void {
  r.parley = { stage: 'offered', at: now, kind: proposalOf(r, defs), port: parleyPort(r, defs) };
}

/** You'll meet them: they wait in the saloon. */
export function agreeToMeet(r: Rival, now: number): void {
  if (r.parley?.stage !== 'offered') return;
  r.parley = { ...r.parley, stage: 'meeting', at: now };
}

/** You didn't answer, or said no, or didn't come. */
export function parleyLapsed(r: Rival, stage: 'declined' | 'stood_up' | 'refused', now: number) {
  if (!r.parley || (r.parley.stage !== 'offered' && r.parley.stage !== 'meeting')) return;
  r.parley = { ...r.parley, stage, at: now };
}

/**
 * You shook on it. Whether they'll keep it is decided now (by their personality) and shows
 * `betrayAfterDays` on. A split moves them to a lane through another region than yours.
 */
export function acceptParley(
  r: Rival,
  lanes: readonly HuntingLane[],
  yourRegion: string | undefined,
  now: number,
  rand: Rand,
  defs = RIVALS,
  others: readonly Rival[] = [],
): void {
  const p = r.parley;
  if (!p || p.stage !== 'meeting' || !p.kind) return;
  const betrays = rand() < personalityOf(r, defs).betray;
  const next = {
    ...p,
    stage: p.kind,
    at: now,
    betrays,
    ...(betrays ? { betrayAt: now + defs.rules.parley.betrayAfterDays * DAY } : {}),
  };
  if (p.kind === 'split') {
    const mine = yourRegion ?? r.region;
    const taken = new Set(others.filter((o) => o.id !== r.id).map((o) => o.lane));
    const away = lanes.filter((l) => !l.regions.includes(mine) && !l.regions.includes(r.region));
    const lane =
      pick(
        away.filter((l) => !taken.has(l.id)),
        rand,
      ) ?? pick(away, rand);
    if (lane) {
      next.homeLane = r.lane;
      next.homeRegion = r.region;
      r.lane = lane.id;
      r.region = lane.regions[0] ?? r.region;
    }
  }
  r.parley = next;
}

/** Sold to the constable: the law has their name and their haunts. */
export function sellToLaw(r: Rival, now: number, defs = RIVALS): void {
  if (!r.parley || r.parley.stage !== 'meeting') return;
  r.heat += defs.rules.parley.sellHeat;
  r.parley = { ...r.parley, stage: 'sold', at: now };
}

/** Is their betrayal due now? */
export function betrayalDue(r: Rival, now: number): boolean {
  const p = r.parley;
  return (
    r.status === 'active' &&
    !!p?.betrays &&
    (p.stage === 'truce' || p.stage === 'split') &&
    now >= (p.betrayAt ?? Infinity)
  );
}

/** They broke it: back on your lane after a split, and blame as before. */
export function betray(r: Rival, now: number): void {
  const p = r.parley;
  if (!p) return;
  if (p.stage === 'split' && p.homeLane) {
    r.lane = p.homeLane;
    if (p.homeRegion) r.region = p.homeRegion;
  }
  r.parley = { ...p, stage: 'betrayed', at: now };
  // A betrayer raids again soon, to make the point.
  r.nextRaidAt = Math.min(r.nextRaidAt, now + 6 * 3600);
}

// --- Beaten.

/** You beat them: struck and taken, or sunk. */
export function defeatRival(state: RivalsState, r: Rival, how: 'taken' | 'sunk', now: number) {
  endRival(state, r, 'defeated', now, how);
}

/** The lead to their stash a beaten rival leaves (piece O's leads; the Hoard is piece T's). */
export function stashLead(
  r: Rival,
  defs = RIVALS,
): { id: string; title: string; where: string; center: Geo; radiusM: number } | undefined {
  const camp = campOf(r, defs);
  if (!camp) return undefined;
  return {
    id: `stash.${r.id.replace(/^rival\./, 'rival_')}`,
    title: `${rivalName(r)}'s stash`,
    where: camp.where,
    center: camp.at,
    radiusM: defs.rules.leadRadiusM,
  };
}

/** Their leading method. */
export function topMethod(r: Pick<Rival, 'methods'>): RivalMethod {
  const s = normalize(r.methods);
  let best: RivalMethod = 'boarding';
  for (const m of RIVAL_METHODS) if (s[m] > s[best]) best = m;
  return best;
}

export function isPersonality(id: string): id is RivalPersonality {
  return (RIVAL_PERSONALITIES as readonly string[]).includes(id);
}
