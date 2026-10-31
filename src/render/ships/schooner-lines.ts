import { PALETTE } from '../style/palette';
import type { HullLines, HullPaint } from './hull-lines';

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

export interface SchoonerLines extends HullLines {
  id: string;
  /** Bowsprit plus jib boom beyond the stem head, and its steeve (rise), degrees. */
  bowsprit: number;
  bowspritSteeveDeg: number;
  fore: MastLines;
  main: MastLines;
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
