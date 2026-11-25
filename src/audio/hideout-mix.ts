/**
 * The rules behind the hideout's sounds (Phase 8 piece I; plan 09 §16.4 row I, plan 15
 * §4.6, §11 Phase 8), kept pure so they can be tested without Web Audio: which sound a
 * piece's material makes, what a work session sounds like for the pieces it put up and the
 * hours it took, what each station sounds like at work, and how a still at work carries.
 */

/** The four ways a piece goes up. */
export type BuildFamily = 'wood' | 'stone' | 'iron' | 'soft';

const STONE = new Set(['brownstone', 'flagstone']);
const SOFT = new Set(['cloth', 'tarpaper', 'turf']);

/** A material from `structures.json` heard as one of the four families. */
export function familyOf(material: string): BuildFamily {
  if (STONE.has(material)) return 'stone';
  if (material === 'iron') return 'iron';
  if (SOFT.has(material)) return 'soft';
  return 'wood';
}

/** The family most of `materials` belong to (wood when there are none). */
export function mainFamily(materials: readonly string[]): BuildFamily {
  const count: Record<BuildFamily, number> = { wood: 0, stone: 0, iron: 0, soft: 0 };
  for (const m of materials) count[familyOf(m)]++;
  let best: BuildFamily = 'wood';
  for (const f of ['stone', 'iron', 'soft'] as const) if (count[f] > count[best]) best = f;
  return best;
}

/** The sounds a cue can play: the hideout bundle's ids, by role. */
export type HideoutCueId =
  | 'saw'
  | 'hammer'
  | 'stone'
  | 'plane'
  | 'pry'
  | 'forge'
  | 'cooperage'
  | 'stillLoad'
  | 'place'
  | 'refused';

/** One sound to play: when (seconds from now), how loud and at what rate. */
export interface Cue {
  id: HideoutCueId;
  delay: number;
  gain: number;
  rate: number;
}

/** The placement knock for a piece of this family: higher for wood, lower for stone. */
export function placeCue(family: BuildFamily): Cue {
  const rate = { wood: 1, stone: 0.78, iron: 1.2, soft: 0.88 }[family];
  return { id: 'place', delay: 0, gain: family === 'soft' ? 0.5 : 0.65, rate };
}

/** The sound of one piece of a family going up (a beat of the work session). */
function workBeat(family: BuildFamily, k: number, random: () => number): Omit<Cue, 'delay'> {
  const jitter = 0.94 + 0.12 * random();
  switch (family) {
    case 'stone':
      return { id: k % 3 === 2 ? 'hammer' : 'stone', gain: 0.8, rate: k % 3 === 2 ? 0.7 : jitter };
    case 'iron':
      return { id: 'hammer', gain: 0.75, rate: 1.3 * jitter };
    case 'soft':
      // Tacks through canvas or tarpaper, turf laid with a thump: a light hammer.
      return { id: 'hammer', gain: 0.45, rate: 1.15 * jitter };
    case 'wood':
      return { id: k % 2 === 0 ? 'saw' : 'hammer', gain: 0.8, rate: jitter };
  }
}

/** A work session heard: the yard's bed for `bedS` seconds and the beats over it. */
export interface WorkVignette {
  bedS: number;
  cues: Cue[];
}

/** The shortest and longest a work session is heard for, real seconds. */
export const WORK_MIN_S = 2.5;
export const WORK_MAX_S = 7;

/**
 * Build pressed: the pieces put up (their materials, in the order built) and the game
 * seconds the work took. The yard plays longer for longer work (a few seconds for an hour,
 * seven for a day or more), and over it a beat for each family in its share of the pieces,
 * so a stone wall sounds of stone and a plank room of saws and hammers.
 */
export function workVignette(
  materials: readonly string[],
  seconds: number,
  random: () => number = Math.random,
): WorkVignette {
  const hours = Math.max(0, seconds) / 3600;
  const bedS = Math.min(WORK_MAX_S, WORK_MIN_S + 1.3 * Math.log2(1 + hours));
  const families = materials.map(familyOf);
  if (families.length === 0) families.push('wood');
  // A beat about every 1.1 s, the last one ending before the bed fades.
  const beats = Math.max(1, Math.min(families.length, Math.floor((bedS - 0.8) / 1.1)));
  const cues: Cue[] = [];
  for (let k = 0; k < beats; k++) {
    const family = families[Math.floor((k / beats) * families.length)] ?? 'wood';
    cues.push({ ...workBeat(family, k, random), delay: 0.25 + k * 1.1 + 0.15 * random() });
  }
  return { bedS, cues };
}

/** Stations by id (`stations.json`). */
export type StationSound = 'workbench' | 'smithy' | 'cooperage' | 'distillery';

export function stationSound(stationId: string | undefined): StationSound {
  switch (stationId) {
    case 'station.smithy':
      return 'smithy';
    case 'station.cooperage':
      return 'cooperage';
    case 'station.distillery':
      return 'distillery';
    default:
      return 'workbench';
  }
}

/**
 * A craft at a station heard: the forge, the cooper's hoops, the still loaded, or at the
 * workbench a saw, the plane and a hammer. Long jobs (four hours or more) get the station's
 * sound twice, the second softer, to say the work went on.
 */
export function craftCues(
  station: StationSound,
  seconds: number,
  random: () => number = Math.random,
): Cue[] {
  const jitter = (): number => 0.96 + 0.08 * random();
  const long = seconds >= 4 * 3600;
  switch (station) {
    case 'smithy':
      return [
        { id: 'forge', delay: 0, gain: 0.85, rate: jitter() },
        ...(long ? [{ id: 'forge' as const, delay: 4.2, gain: 0.45, rate: jitter() }] : []),
      ];
    case 'cooperage':
      return [
        { id: 'cooperage', delay: 0, gain: 0.85, rate: jitter() },
        ...(long ? [{ id: 'cooperage' as const, delay: 3.1, gain: 0.45, rate: jitter() }] : []),
      ];
    case 'distillery':
      return [{ id: 'stillLoad', delay: 0, gain: 0.8, rate: 1 }];
    case 'workbench':
      return [
        { id: 'saw', delay: 0, gain: 0.75, rate: jitter() },
        { id: 'plane', delay: 2.1, gain: 0.7, rate: jitter() },
        { id: 'hammer', delay: 3.7, gain: 0.7, rate: jitter() },
        ...(long ? [{ id: 'saw' as const, delay: 5.6, gain: 0.4, rate: jitter() }] : []),
      ];
  }
}

/** A still at work is heard this far off, meters. */
export const STILL_REACH_M = 28;

/**
 * The still at work from `distanceM` away: full beside it, gone past `STILL_REACH_M`,
 * duller with distance.
 */
export function stillLevel(distanceM: number): { gain: number; lowpassHz: number } {
  if (!(distanceM < STILL_REACH_M)) return { gain: 0, lowpassHz: 800 };
  const u = Math.max(0, distanceM - 2) / (STILL_REACH_M - 2);
  return { gain: (1 - u) ** 2, lowpassHz: 6000 - 5000 * u };
}

/** Chimes come no closer than this, seconds: a night's batches all done ring once. */
export const CHIME_GAP_S = 2;

/** The alarm's second stroke follows the first this soon, seconds. */
export const ALARM_STROKE_S = 0.32;

/**
 * Notification chimes by priority (plan 13 §7, plan 15 §4.6): what a notice's event rings
 * when nothing else in the game already sounds for it. Critical is the alarm (the bright
 * bell twice, low); important the soft bell. Ambient news rings nothing, and neither do
 * the refusals most notices are. The events with a sound of their own (a tier's stinger,
 * the ice giving, the pursuit's music, a contract's bell) are left out, so nothing rings
 * twice.
 */
export const NOTICE_CHIMES = {
  // Critical: the law has your name, she's going down, they've found your hideout.
  ReportFiled: 'alarm',
  ShipFoundering: 'alarm',
  HideoutSpotted: 'alarm',
  // Important: something to read or follow up.
  LetterReceived: 'chimeSoft',
  LeadUpdated: 'chimeSoft',
  ClueFound: 'chimeSoft',
  RivalEmerged: 'chimeSoft',
  LegendCompleted: 'chimeBright',
} as const;

export type NoticeChimeEvent = keyof typeof NOTICE_CHIMES;

/** The slipway's work as Build's materials: planking and caulking, iron where it's fitted. */
export const SLIPWAY_REPAIR: readonly string[] = ['plank', 'plank', 'iron', 'plank'];
export const SLIPWAY_FIT: readonly string[] = ['iron', 'plank', 'iron'];
export const SLIPWAY_BUILD: readonly string[] = [
  'plank',
  'plank',
  'iron',
  'plank',
  'plank',
  'iron',
];
