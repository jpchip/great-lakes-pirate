import { PALETTE } from '../style/palette';
import { hullLevels, type HullLines, type HullPaint } from './hull-lines';

/**
 * Hull lines and sail plan for the procedural schooner generator (plan 14 §5): one record
 * per class, so T2 and T3 (and NPC schooners) are new numbers, not new code. Meters, in
 * the ship's local frame: bow toward -z, starboard +x, waterline at y = 0, amidships at
 * z = 0. Lengths along the deck run aft from the stem head.
 */

export interface MastLines {
  /** Distance aft of the stem head, at the deck. */
  station: number;
  /** Lower mast above the deck to the hounds (crosstrees). */
  height: number;
  /** Topmast above the hounds. */
  topmast: number;
  /** Rake aft, degrees. */
  rakeDeg: number;
  /** Gooseneck (boom jaws) above the deck. */
  gooseneck: number;
  boom: number;
  gaff: number;
  /** Gaff jaws (throat) above the deck with the sail fully hoisted. */
  throat: number;
  /** Gaff angle above the horizontal, degrees. */
  peakDeg: number;
}

export interface HeadsailLines {
  /** Tack: distance forward of the stem head along the bowsprit. */
  tackOut: number;
  /** Head on the stay: which mast it is set from, and the height above the deck. */
  headHeight: number;
  /** Clew distance aft of the tack, along the deck line, fully set. */
  foot: number;
  /** Clew height above the tack. */
  clewRise: number;
}

/** A house or hatch on deck, between two stations (meters aft of the stem head). */
export interface DeckHouse {
  from: number;
  to: number;
  /** Fraction of the beam. */
  width: number;
  height: number;
}

/**
 * What stands on deck. Optional: without it the T1's layout is placed from the masts
 * (a cabin trunk aft of the main, the main and fore hatches).
 */
export interface DeckLayout {
  houses: readonly DeckHouse[];
  /** The windlass, meters aft of the stem head. */
  windlass: number;
  /** A yawl boat hung in davits across the stern, as the lake schooners carried. */
  yawlBoat?: { length: number; beam: number };
}

export interface SchoonerLines extends HullLines {
  id: string;
  /**
   * Scale for the spar sections, the crosstrees, the chainplate spread and the pennant,
   * so a bigger hull doesn't carry the T1's toothpicks. Default 1.
   */
  rigScale?: number;
  deck?: DeckLayout;
  /** Bowsprit plus jib boom beyond the stem head, and its steeve (rise), degrees. */
  bowsprit: number;
  bowspritSteeveDeg: number;
  fore: MastLines;
  main: MastLines;
  /** A three-master's third mast, aft of the main, with the biggest boom (the spanker). */
  mizzen?: MastLines;
  staysail: HeadsailLines;
  jib: HeadsailLines;
  /** Sail cloth depth (camber) as a fraction of the chord, drawing. */
  camber: number;
  /** The reefed gaff sails keep this fraction of their luff. */
  reefedHoist: number;
  paint: HullPaint & {
    house: number;
    spar: number;
    canvas: number;
    rope: number;
    pennant: number;
    /** A two-color pennant's fly (outer half). */
    pennantFly?: number;
    telltale: number;
  };
}

/**
 * The T1 small schooner (ships.json `ship.t1_schooner`, 20 m): a two-masted Great Lakes
 * fore-and-aft schooner after `references/schooner.png`, white topsides and a black boot,
 * a long bowsprit, gaff topsails above both gaffs. Hull dimensions match the ship record
 * and its buoyancy spans (17 × 5 m sampled inside a 20 × 5.6 m hull).
 */
export const T1_SCHOONER_LINES: SchoonerLines = {
  id: 'ship.t1_schooner',
  length: 20,
  beam: 5.6,
  draft: 1.6,
  freeboard: 1.15,
  sheerBow: 0.75,
  sheerStern: 0.3,
  bulwark: 0.55,
  stemRake: 1.6,
  transomRake: 0.7,
  transomWidth: 0.5,
  bowsprit: 7.5,
  bowspritSteeveDeg: 9,
  fore: {
    station: 6,
    height: 13.5,
    topmast: 5,
    rakeDeg: 2.5,
    gooseneck: 1.3,
    boom: 6.2,
    gaff: 4.6,
    throat: 11.6,
    peakDeg: 32,
  },
  main: {
    station: 12.4,
    height: 14.5,
    topmast: 5.5,
    rakeDeg: 3.5,
    gooseneck: 1.3,
    boom: 9.4,
    gaff: 5.6,
    throat: 12.6,
    peakDeg: 30,
  },
  staysail: { tackOut: 0.4, headHeight: 12.2, foot: 5.2, clewRise: 0.7 },
  jib: { tackOut: 5.6, headHeight: 17.4, foot: 7.4, clewRise: 1.6 },
  camber: 0.09,
  reefedHoist: 0.6,
  paint: {
    topsides: PALETTE.hullWhite,
    boot: PALETTE.hullBlack,
    bottom: PALETTE.bootRed,
    rail: PALETTE.sparBrown,
    bulwarkInside: PALETTE.railWhite,
    deck: PALETTE.deckWood,
    house: PALETTE.weatheredWood,
    spar: PALETTE.sparBrown,
    canvas: PALETTE.canvas,
    rope: PALETTE.ink,
    pennant: PALETTE.flagRed,
    telltale: PALETTE.flagRed,
  },
};

/**
 * The T2 schooner (ships.json `ship.t2_schooner`, 30 m, plan 10 §2): a 100 ft two-masted
 * lake schooner of the kind that carried lumber, grain and coal around 1900, after
 * `references/schooner.png` and the R1 photos. Half again the T1 in every line, deeper,
 * with more sheer, a forecastle house for the crew of four, three hatches between the
 * masts and a yawl boat in davits across the stern. White topsides with a green rail and
 * trim tell her from the T1 at a distance, along with her size.
 */
export const T2_SCHOONER_LINES: SchoonerLines = {
  id: 'ship.t2_schooner',
  length: 30,
  beam: 7.6,
  draft: 2.6,
  freeboard: 1.55,
  sheerBow: 1.05,
  sheerStern: 0.45,
  bulwark: 0.75,
  stemRake: 2.4,
  transomRake: 1.0,
  transomWidth: 0.55,
  shape: {
    sectionPower: 0.38,
    levels: hullLevels(2.6, 1.55, -0.3, 0.42),
    bootBottom: -0.3,
    bootTop: 0.42,
  },
  rigScale: 1.45,
  bowsprit: 11,
  bowspritSteeveDeg: 10,
  fore: {
    station: 8.8,
    height: 19.5,
    topmast: 7.5,
    rakeDeg: 2.5,
    gooseneck: 1.7,
    boom: 9.4,
    gaff: 6.9,
    throat: 16.8,
    peakDeg: 32,
  },
  main: {
    station: 18.4,
    height: 21,
    topmast: 8.2,
    rakeDeg: 3.5,
    gooseneck: 1.9,
    boom: 12.8,
    gaff: 8.4,
    throat: 18.3,
    peakDeg: 30,
  },
  staysail: { tackOut: 0.6, headHeight: 17.6, foot: 7.8, clewRise: 1.0 },
  jib: { tackOut: 8.2, headHeight: 25.2, foot: 11, clewRise: 2.4 },
  camber: 0.09,
  reefedHoist: 0.6,
  deck: {
    houses: [
      // Forecastle house: the crew's berths and the galley, forward of the foremast.
      { from: 3.6, to: 7.4, width: 0.42, height: 1.6 },
      // Fore, main and after hatches between the masts.
      { from: 10.4, to: 12.4, width: 0.36, height: 0.5 },
      { from: 13.4, to: 15.6, width: 0.36, height: 0.5 },
      { from: 16.2, to: 17.6, width: 0.3, height: 0.45 },
      // The after cabin, the captain's and mate's, with its trunk aft of the main.
      { from: 19.8, to: 26.2, width: 0.52, height: 1.25 },
    ],
    windlass: 2.3,
    yawlBoat: { length: 5.2, beam: 1.6 },
  },
  paint: {
    topsides: PALETTE.hullWhite,
    boot: PALETTE.hullBlack,
    bottom: PALETTE.bootRed,
    rail: PALETTE.hullGreen,
    bulwarkInside: PALETTE.railWhite,
    deck: PALETTE.deckWood,
    house: PALETTE.hullGreen,
    spar: PALETTE.sparBrown,
    canvas: PALETTE.canvas,
    rope: PALETTE.ink,
    pennant: PALETTE.flagRed,
    telltale: PALETTE.flagRed,
  },
};

/**
 * The T3 three-master (ships.json `ship.t3_schooner`, 42 m, plan 10 §2, plan 02 §10): a
 * 140 ft three-masted lake schooner of the 1870s–90s grain and lumber trade, the largest
 * the lakes built under sail, with the long spanker boom over the stern that they carried
 * on the mizzen. Deeper and higher-sided again than the T2, a long run of hatches between
 * the masts, the crew's forecastle forward and the cabin aft. Black topsides with buff
 * trim and houses, as many of them were painted, so she reads apart from the white T1 and
 * T2 at any distance.
 */
export const T3_SCHOONER_LINES: SchoonerLines = {
  id: 'ship.t3_schooner',
  length: 42,
  beam: 9.4,
  draft: 3.5,
  freeboard: 1.9,
  sheerBow: 1.3,
  sheerStern: 0.55,
  bulwark: 0.9,
  stemRake: 3.2,
  transomRake: 1.3,
  transomWidth: 0.58,
  shape: {
    sectionPower: 0.36,
    levels: hullLevels(3.5, 1.9, -0.35, 0.5),
    bootBottom: -0.35,
    bootTop: 0.5,
  },
  rigScale: 1.85,
  bowsprit: 14,
  bowspritSteeveDeg: 10,
  fore: {
    station: 10.5,
    height: 24,
    topmast: 9,
    rakeDeg: 2.5,
    gooseneck: 2.1,
    boom: 8.8,
    gaff: 7.6,
    throat: 20.8,
    peakDeg: 32,
  },
  main: {
    station: 20,
    height: 24.5,
    topmast: 9.2,
    rakeDeg: 3,
    gooseneck: 2.1,
    boom: 8.8,
    gaff: 7.8,
    throat: 21.2,
    peakDeg: 31,
  },
  mizzen: {
    station: 29.5,
    height: 24,
    topmast: 8.8,
    rakeDeg: 3.5,
    gooseneck: 2.3,
    boom: 14.5,
    gaff: 8.6,
    throat: 20.6,
    peakDeg: 30,
  },
  staysail: { tackOut: 0.8, headHeight: 21.5, foot: 9.5, clewRise: 1.2 },
  jib: { tackOut: 10.5, headHeight: 30.5, foot: 13.5, clewRise: 3 },
  camber: 0.09,
  reefedHoist: 0.6,
  deck: {
    houses: [
      // The forecastle house: berths for a crew of eight and the galley.
      { from: 4.5, to: 9.2, width: 0.44, height: 1.7 },
      // Hatches between the masts: two between fore and main, two between main and mizzen.
      { from: 12.4, to: 14.8, width: 0.38, height: 0.55 },
      { from: 15.8, to: 18.4, width: 0.38, height: 0.55 },
      { from: 21.8, to: 24.4, width: 0.38, height: 0.55 },
      { from: 25.4, to: 27.8, width: 0.34, height: 0.5 },
      // The after cabin under the spanker boom.
      { from: 31.2, to: 38.6, width: 0.5, height: 1.4 },
    ],
    windlass: 3,
    yawlBoat: { length: 6.2, beam: 1.8 },
  },
  paint: {
    topsides: 0x2c302f,
    boot: PALETTE.bootRed,
    bottom: PALETTE.bootRed,
    rail: PALETTE.stackBuff,
    bulwarkInside: PALETTE.railWhite,
    deck: PALETTE.deckWood,
    house: PALETTE.stackBuff,
    spar: PALETTE.sparBrown,
    canvas: PALETTE.canvas,
    rope: PALETTE.ink,
    pennant: PALETTE.flagRed,
    telltale: PALETTE.flagRed,
  },
};

/** The player's schooners, keyed by ships.json id (and `modelId`). */
export const SCHOONER_LINES: Readonly<Record<string, SchoonerLines>> = {
  [T1_SCHOONER_LINES.id]: T1_SCHOONER_LINES,
  [T2_SCHOONER_LINES.id]: T2_SCHOONER_LINES,
  [T3_SCHOONER_LINES.id]: T3_SCHOONER_LINES,
};

/** A player class's lines; the T1's for anything unknown, so a new record still draws. */
export function schoonerLines(id: string | undefined): SchoonerLines {
  return (id !== undefined ? SCHOONER_LINES[id] : undefined) ?? T1_SCHOONER_LINES;
}

/** Colors to draw a ship in over her class's (plan 10 §7): see `sim/shipyard/cosmetics`. */
export interface LiveryColors {
  topsides?: number;
  trim?: number;
  canvas?: number;
  pennant?: number;
  pennantFly?: number;
}

/**
 * Her lines in her own paint: topsides, the rail (and houses painted to match it, as the
 * T2's are), the canvas, and the pennant. The lines are shared, so this makes a copy.
 */
export function liveried(lines: SchoonerLines, livery: LiveryColors | undefined): SchoonerLines {
  if (!livery || Object.keys(livery).length === 0) return lines;
  const p = lines.paint;
  const paint = { ...p };
  if (livery.topsides !== undefined) paint.topsides = livery.topsides;
  if (livery.trim !== undefined) {
    paint.rail = livery.trim;
    if (p.house === p.rail) paint.house = livery.trim;
  }
  if (livery.canvas !== undefined) paint.canvas = livery.canvas;
  if (livery.pennant !== undefined) {
    paint.pennant = livery.pennant;
    if (livery.pennantFly !== undefined) paint.pennantFly = livery.pennantFly;
    else delete paint.pennantFly;
  }
  return { ...lines, paint };
}
