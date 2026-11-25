/**
 * The islands' sounds, as rules (Phase 9 piece Y; plan 15 §4.1, §4.5, §11 Phase 9): which beds
 * play on an island by its tier and the season, how the birds and the surf answer the day and
 * the wind, the drips and the surge of a sea cave, how far an animal's call carries and where
 * each animal's cue goes, and how a spade and a grapple sound. Pure functions, unit-tested;
 * `island-audio.ts` plays them.
 */

/** The island's tier (plan 11 §2): hero islands are walked end to end. */
export type IslandTier = 'hero' | 'standard' | 'minor';

export type Season = 'winter' | 'spring' | 'summer' | 'autumn';

/** Winter is December to February; the lake's months are the calendar's. */
export function seasonOf(month0: number): Season {
  const m = ((Math.floor(month0) % 12) + 12) % 12;
  if (m === 11 || m <= 1) return 'winter';
  if (m <= 4) return 'spring';
  if (m <= 7) return 'summer';
  return 'autumn';
}

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

/** How much of the songbirds sing, by season: spring's dawn chorus, summer's, then none. */
const BIRDS_BY_SEASON: Record<Season, number> = {
  spring: 1,
  summer: 0.9,
  autumn: 0.25,
  winter: 0,
};

/** Hero islands are walked end to end with a wood and a creek; rock islands have few singers. */
const BIRDS_BY_TIER: Record<IslandTier, number> = { hero: 1, standard: 0.7, minor: 0.35 };

/** A creek runs on the bigger islands, swollen at the thaw and low in autumn; frozen in winter. */
const CREEK_BY_TIER: Record<IslandTier, number> = { hero: 0.7, standard: 0.35, minor: 0 };
const CREEK_BY_SEASON: Record<Season, number> = {
  spring: 1.2,
  summer: 1,
  autumn: 0.7,
  winter: 0,
};

export interface IslandAir {
  season: Season;
  tier: IslandTier;
  /** The air's wind on the island, knots. */
  windKn: number;
  /** 0 at night, 1 in full day. */
  daylight01: number;
  /** Under the trees' roof or in a building: the birds and the surf come through quieter. */
  inside: boolean;
}

export interface IslandBeds {
  /** Songbirds, 0–1 (the loop's gain before the bus). */
  birds: number;
  /** A creek over its stones, 0–1. */
  creek: number;
  /** Surf on the rock, 0–1. */
  surf: number;
}

/** The island beds at this moment, from the tier, the season, the day and the wind. */
export function islandBeds(air: IslandAir): IslandBeds {
  const windDamp = clamp01(1 - air.windKn / 22);
  const day = 0.08 + 0.92 * clamp01(air.daylight01);
  const indoors = air.inside ? 0.4 : 1;
  const birds = BIRDS_BY_SEASON[air.season] * BIRDS_BY_TIER[air.tier] * day * windDamp * indoors;
  const creek = clamp01(CREEK_BY_TIER[air.tier] * CREEK_BY_SEASON[air.season]) * indoors;
  // The surf is the rock islands' voice; the wind raises it, and a sheltered shore hears less.
  const swell = 0.25 + 0.75 * clamp01(air.windKn / 20);
  const surfTier = air.tier === 'minor' ? 0.9 : air.tier === 'standard' ? 0.25 : 0.1;
  const surf = surfTier * swell * indoors;
  return { birds, creek, surf };
}

/** Seconds until the woodpecker drums again, or undefined when it won't (winter, night, rock). */
export function woodpeckerGapS(
  random: () => number,
  air: Pick<IslandAir, 'season' | 'tier' | 'daylight01'>,
): number | undefined {
  if (air.season === 'winter' || air.season === 'autumn') return undefined;
  if (air.tier === 'minor' || air.daylight01 < 0.5) return undefined;
  return 40 + random() * 70;
}

/** Seconds until the next drip in a sea cave: a few seconds apart, unevenly. */
export function caveDripGapS(random: () => number): number {
  return 2.5 + random() * 4.5;
}

/** Which drip sound a cave drip gets, alternating at random. */
export function dripVariant(random: () => number): 1 | 2 {
  return random() < 0.5 ? 1 : 2;
}

/**
 * The cave's hush, 0–1: full inside the roof, and it fades out over a second or so once
 * you're out of it (the caller eases it).
 */
export function caveRoomLevel(inside: boolean): number {
  return inside ? 0.8 : 0;
}

/**
 * The surge at a cave mouth, by the swell's height in meters: a small roll is a small boom,
 * a big one fills the cave. Never silent, never over full.
 */
export function surgeGain(swellM: number): number {
  return Math.min(1, Math.max(0.3, swellM / 2));
}

export type AnimalKind = 'deer' | 'bear' | 'wolf';
export type AnimalCueState = 'wary' | 'threaten' | 'attack' | 'flee' | 'bolt';

export interface AnimalCueSound {
  /** Sound ids to play, in order. */
  sounds: readonly string[];
  /** Seconds after the cue for each one. */
  delayS: readonly number[];
  /** Whether it's a voice a person would caption (the HUD still says what's happening). */
  caption: string | undefined;
}

const DEER_SNORT = 'voice.deer.snort';
const DEER_BOUND = 'sfx.deer.bound';
const BEAR_HUFF = 'voice.bear.huff';
const BEAR_GROWL = 'voice.bear.growl';
const BEAR_CRASH = 'sfx.bear.crash';
const WOLF_HOWL = ['voice.wolf.howl-1', 'voice.wolf.howl-2'] as const;

/**
 * Which sound an animal makes at this cue: a deer snorts and bounds off when it bolts; a
 * bear huffs when it stands up to you and growls as it charges; wolves howl from the trees
 * when they're about, and the nearer pack answers with the second howl. A wary bear and a
 * fleeing bear make no sound (the HUD line and the crash in the brush carry it).
 */
export function animalCue(kind: AnimalKind, state: AnimalCueState, variant = 0): AnimalCueSound {
  const none: AnimalCueSound = { sounds: [], delayS: [], caption: undefined };
  if (kind === 'deer') {
    if (state !== 'bolt') return none;
    return {
      sounds: [DEER_SNORT, DEER_BOUND],
      delayS: [0, 0.25],
      caption: 'Deer bolting off through the brush',
    };
  }
  if (kind === 'bear') {
    if (state === 'threaten')
      return { sounds: [BEAR_HUFF], delayS: [0], caption: 'A bear huffing, close by' };
    if (state === 'attack')
      return { sounds: [BEAR_GROWL], delayS: [0], caption: 'A bear growling, charging' };
    if (state === 'flee')
      return {
        sounds: [BEAR_HUFF, BEAR_CRASH],
        delayS: [0, 0.2],
        caption: 'A bear crashing off through the brush',
      };
    return none;
  }
  if (state === 'wary')
    return {
      sounds: [WOLF_HOWL[variant % 2] ?? WOLF_HOWL[0]],
      delayS: [0],
      caption: 'Wolves howling in the trees',
    };
  if (state === 'threaten')
    return { sounds: [WOLF_HOWL[1]], delayS: [0], caption: 'Wolves howling, nearer' };
  return none;
}

/**
 * How loud an animal's call is heard from `distanceM` away: full within 10 m, falling away to
 * nothing by 300 m (a wolf in the next valley is heard, a bear across the island is not).
 */
export function callGain(distanceM: number): number {
  if (!Number.isFinite(distanceM)) return 0;
  return clamp01(1 - Math.max(0, distanceM - 10) / 290) ** 1.5;
}

/** Spade strikes for a dig: three over the hold's last two seconds, as the spade goes in. */
export const SPADE_STRIKES_S: readonly number[] = [0, 0.7, 1.4];

/** The grapple's haul comes in with its stick-slip over this long. */
export const GRAPPLE_HAUL_S = 3.5;

/**
 * The ending's air, once the run is over: it plays whole, at full level, after a second, so
 * the last shot or the last word has time to end first.
 */
export const ENDING_DELAY_S = 1;
