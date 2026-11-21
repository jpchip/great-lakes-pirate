import { z } from 'zod';
import { idOf } from './common';

/**
 * Hunting and wildlife (plan 11 §3.2, §4; §18.4 piece V; `wildlife.json`): the deer you
 * poach on the larger islands, the black bears and winter wolves that warn before they
 * attack, the rifle shot at an animal, dressing and carrying a carcass, the deer sign you
 * track by, and the winter traplines. Rates are per real second on foot unless named.
 */
const pos = z.number().positive();
const nonneg = z.number().nonnegative();
const share = z.number().min(0).max(1);
const month = z.number().int().min(1).max(12);
const range = z.tuple([nonneg, nonneg]);

export const speciesSchema = z.object({
  id: idOf('animal'),
  name: z.string().min(1),
  /** In a sentence: "the deer". */
  noun: z.string().min(1),
  /** Deer graze and run; predators warn, then attack or flee (plan 11 §3.2's FSM). */
  kind: z.enum(['deer', 'predator']),
  /** The calendar months it's about (1 January): bears sleep the winter, wolves come with it. */
  months: z.array(month).min(1),
  /** How many come together: a deer's herd, a wolf pack. */
  group: z.tuple([z.number().int().positive(), z.number().int().positive()]),
  walkMps: pos,
  runMps: pos,
  /** Rifle hits it takes to kill. */
  hp: z.number().int().positive(),
  senses: z.object({
    /** Sees a man standing in daylight this far; crouching, dark and stillness cut it. */
    sightM: pos,
    /** Hears your footsteps this many times their radius. */
    hearing: pos,
    /** Smells you this far when you're upwind of it. */
    smellM: pos,
  }),
  /** Seconds an alarmed animal stands looking before it settles again. */
  alertS: pos,
  /** Seconds it runs once it bolts. */
  fleeS: pos,
  /** A deer bolts if you come closer than this while it's looking at you (0: never). */
  fleeAtM: nonneg,
  /** It won't come within this many meters of a fire (plan 11 §3.2: they avoid fire). */
  fire: z.object({ keepOffM: pos }),
  /** For the drawing and the shot's aim point, m. */
  lengthM: pos,
  heightM: pos,
  /** Bears and wolves: Wander → Wary → Threaten → Attack or Flee. */
  predator: z
    .object({
      /** Notices you and watches from this far. */
      waryM: pos,
      /** Closer than this it threatens (stands, huffs, growls). */
      threatenM: pos,
      /** Come on it closer than this and it attacks at once (surprised, or its cubs). */
      closeM: pos,
      /** Seconds it threatens before it decides. */
      threatenS: pos,
      /** The chance it attacks rather than bluffs and goes, when the threat runs out. */
      boldness: share,
      /** Reach of a bite or a swipe, m; the damage to your health; how often. */
      attackM: pos,
      damage: pos,
      everyS: pos,
      /** The chance a shot that misses (or a gunshot near) sends it off. */
      shotFlee: share,
      /** The chance a wound sends it off. */
      hurtFlee: share,
      /** The chance a loud noise (a shout, a stone's clatter) sends it off while it threatens. */
      noiseFlee: share,
    })
    .optional(),
  /** The warning lines (until piece Y's growls and howls). */
  warn: z
    .object({
      wary: z.string().min(1),
      threaten: z.string().min(1),
      attack: z.string().min(1),
      flee: z.string().min(1),
    })
    .optional(),
});

export const wildlifeFileSchema = z.object({
  species: z.array(speciesSchema).min(1),
  /**
   * The islands with game: the deer an island carries at the run's start (spread by the
   * seed), and the chance of a bear about, or a wolf pack in winter, on any landing.
   */
  islands: z.array(
    z.object({
      island: idOf('island'),
      deer: z.number().int().nonnegative(),
      bear: share,
      wolves: share,
    }),
  ),
  population: z.object({
    /** A run's herd is the island's deer this share either side. */
    spread: share,
    /** Deer that come back a calendar week after the herd's been shot down. */
    regrowPerWeek: nonneg,
    /** The herd lies up at least this far from where you land, m. */
    herdMinFromLandingM: pos,
    /** And within this of its middle. */
    herdSpreadM: pos,
    /** And this far from anyone's door. */
    keepClearOfHomesM: nonneg,
  }),
  hunt: z.object({
    /** The rifle reaches this far at game, m, within this many degrees of where you face. */
    rangeM: pos,
    coneDeg: pos,
    /** The chance to hit, near and far, straight between. */
    hitNear: z.object({ m: pos, p: share }),
    hitFar: z.object({ m: pos, p: share }),
    /** Steadier crouched, worse on the move, and a running deer is harder. */
    crouched: pos,
    moving: share,
    runningTarget: share,
    /** A hit deer dropped where it stood; else it runs wounded and is down in this long. */
    killChance: share,
    woundedS: pos,
    /** A shot on an island carries this far (keepers and fishermen hear it). */
    noiseM: pos,
    /** Seconds held to field-dress a deer, and with the Poacher's woodcraft. */
    dressS: pos,
    woodcraftDressS: pos,
    /** A dressed carcass: what it makes in the hold, its size and how slow it walks you. */
    carcass: z.object({
      good: idOf('good'),
      cu: z.number().int().positive(),
      speed: share,
      woodcraftSpeed: share,
    }),
  }),
  /** Deer sign: tracks and droppings laid toward the herd from near where you land. */
  sign: z.object({
    count: z.number().int().positive(),
    firstM: range,
    stepM: pos,
    readM: pos,
  }),
  /** The winter traplines round the trappers' cabins (plan 11 §4). */
  traps: z.object({
    /** A trap from the ship's lockers. */
    store: idOf('store'),
    /** The open season, calendar months: a trap is set only then. */
    months: z.array(month).min(1),
    spotsPerLine: z.number().int().positive(),
    /** Spots lie this far from the cabin's door, m. */
    spotM: range,
    /** Calendar weeks before a set trap may hold something. */
    fillWeeks: range,
    /** The chance it does, and with woodcraft. */
    catch: share,
    woodcraftCatch: share,
    /** A pelt left this many weeks after the catch is spoiled. */
    spoilWeeks: pos,
    good: idOf('good'),
    reachM: pos,
    lines: z.array(z.object({ island: idOf('island'), poi: z.string().min(1) })),
  }),
});

export type SpeciesDef = z.infer<typeof speciesSchema>;
export type WildlifeFile = z.infer<typeof wildlifeFileSchema>;
