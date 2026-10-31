import { PALETTE } from '../style/palette';
import { hullLevels, type HullLines, type HullPaint } from './hull-lines';

/**
 * NPC ship lines for the parametric generator (plan 14 §5; Phase 3 piece H): the hull,
 * then the parts a steamer or a schooner-barge is built from, placed by station along
 * the deck. One record per class, keyed by its ships.json `modelId`, so a new class is
 * new numbers, not new code.
 *
 * Meters in the ship's own frame at full size (the record's `displayScale` shrinks the
 * model as a whole). Stations (`at`, `from`, `to`) are meters aft of the stem head;
 * heights (`base`, `height`) are above the deck at that station.
 */

export interface HouseLines {
  from: number;
  to: number;
  width: number;
  height: number;
  /** Above the deck, meters: 0 sits on deck, or on top of a lower house. */
  base?: number;
  /** One row of windows down each side and across the ends. */
  windows?: { spacing: number; lit: number };
  color?: number;
  roof?: number;
}

export interface StackLines {
  at: number;
  radius: number;
  height: number;
  base?: number;
  rakeDeg: number;
  color: number;
  /** A painted band below the top, and the top itself (soot black on most). */
  band?: number;
  top: number;
}

export interface GaffLines {
  gooseneck: number;
  boom: number;
  gaff: number;
  /** Gaff jaws above the deck. */
  throat: number;
  peakDeg: number;
}

export interface NpcMastLines {
  at: number;
  height: number;
  rakeDeg: number;
  radius: number;
  /** A gaff and boom: canvas furled on the boom, or a sail set. */
  gaff?: GaffLines;
}

export interface BoatLines {
  at: number;
  length: number;
  /** Center off the centerline, meters; both sides get one. */
  x: number;
  base: number;
}

/** Running lights (1900 rules for the Great Lakes); see running-lights.ts. */
export type LightKind = 'masthead' | 'range' | 'port' | 'starboard' | 'stern' | 'towing';

export interface LightLines {
  kind: LightKind;
  at: number;
  height: number;
  /** Off the centerline, meters, for the sidelights (the side follows the kind). */
  x?: number;
}

export interface NpcShipLines extends HullLines {
  id: string;
  /** Bowsprit beyond the stem head, and its steeve, degrees. */
  bowsprit?: { length: number; steeveDeg: number };
  /** Bow gun, `at` a station on the foredeck (the cutter). */
  gun?: { at: number };
  houses: HouseLines[];
  hatches?: { from: number; to: number; count: number; width: number; length: number };
  stacks: StackLines[];
  masts: NpcMastLines[];
  /** Gaff sails set (the schooner-barge, which sails under tow), or canvas furled. */
  sailsSet: boolean;
  /** A jib from the bowsprit end to the foremast head, when the sails are set. */
  jib?: boolean;
  boats: BoatLines[];
  lights: LightLines[];
  paint: HullPaint & {
    house: number;
    roof: number;
    hatch: number;
    spar: number;
    canvas: number;
    rope: number;
    smoke: number;
  };
}

const HOUSE = PALETTE.railWhite;

/**
 * Steam ore freighter, a 400 ft laker of 1900 (`references/freighter1.png`, the *Onoko*,
 * and `freighter2.png`): pilothouse on a forecastle house at the bow, a long run of
 * hatches, the after cabin and the stack at the stern, two pole masts. Oxide-red topsides.
 * Drawn at 0.85 (plan 03 §3.5).
 */
const ORE_FREIGHTER: NpcShipLines = {
  id: 'ship.ore_freighter',
  length: 122,
  beam: 14.6,
  draft: 4.6,
  freeboard: 3,
  sheerBow: 2.4,
  sheerStern: 0.8,
  bulwark: 0.9,
  stemRake: 0.7,
  transomRake: 2.6,
  transomWidth: 0.5,
  shape: {
    runEnd: 0.13,
    entranceStart: 0.86,
    sectionPower: 0.12,
    forefootStart: 0.9,
    levels: hullLevels(4.6, 3, -0.6, 0.35),
    bootBottom: -0.6,
    bootTop: 0.35,
  },
  houses: [
    // Forecastle house, then the pilothouse and texas on top of it.
    { from: 2.5, to: 13, width: 10, height: 2.6, windows: { spacing: 2.4, lit: 0.6 } },
    { from: 4, to: 10, width: 7.2, height: 2.8, base: 2.6, windows: { spacing: 1.2, lit: 1 } },
    // After cabin and the engine-room house on it.
    { from: 101, to: 119.5, width: 12, height: 2.6, windows: { spacing: 2.2, lit: 0.7 } },
    { from: 104, to: 113, width: 6.5, height: 1.5, base: 2.6, color: PALETTE.deckSteel },
  ],
  hatches: { from: 17, to: 97, count: 12, width: 8.6, length: 3 },
  stacks: [
    {
      at: 109,
      radius: 1.35,
      height: 9.5,
      base: 2.6,
      rakeDeg: 7,
      color: PALETTE.hullBlack,
      band: PALETTE.bootRed,
      top: PALETTE.hullBlack,
    },
  ],
  masts: [
    { at: 13.5, height: 24, rakeDeg: 4, radius: 0.28 },
    { at: 99, height: 21, rakeDeg: 4, radius: 0.26 },
  ],
  sailsSet: false,
  boats: [{ at: 116, length: 6, x: 4.6, base: 2.6 }],
  lights: [
    { kind: 'masthead', at: 13.3, height: 16 },
    { kind: 'port', at: 7, height: 4.2, x: 3.9 },
    { kind: 'starboard', at: 7, height: 4.2, x: 3.9 },
    { kind: 'range', at: 98.8, height: 19 },
    { kind: 'stern', at: 120.5, height: 3 },
  ],
  paint: {
    topsides: PALETTE.hullOxide,
    boot: PALETTE.hullBlack,
    bottom: PALETTE.bootRed,
    rail: PALETTE.hullOxide,
    bulwarkInside: PALETTE.hullOxide,
    deck: PALETTE.deckSteel,
    house: HOUSE,
    roof: PALETTE.weatheredWood,
    hatch: PALETTE.weatheredWood,
    spar: PALETTE.sparBrown,
    canvas: PALETTE.canvas,
    rope: PALETTE.ink,
    smoke: PALETTE.coalSmoke,
  },
};

/**
 * Schooner-barge, a 200 ft three-master cut down to sail under tow (the *Noquebay*'s
 * kind, R1): a full-bodied hull, bare lower masts, gaff sails set to help the tow.
 */
const SCHOONER_BARGE: NpcShipLines = {
  id: 'ship.schooner_barge',
  length: 61,
  beam: 10.7,
  draft: 3,
  freeboard: 1.8,
  sheerBow: 1.2,
  sheerStern: 0.5,
  bulwark: 0.8,
  stemRake: 2.2,
  transomRake: 1.2,
  transomWidth: 0.55,
  shape: {
    runEnd: 0.3,
    entranceStart: 0.68,
    sectionPower: 0.22,
    forefootStart: 0.78,
    levels: hullLevels(3, 1.8, -0.35, 0.3),
    bootBottom: -0.35,
    bootTop: 0.3,
  },
  bowsprit: { length: 9, steeveDeg: 8 },
  houses: [
    { from: 50, to: 57.5, width: 5.4, height: 1.9, windows: { spacing: 1.6, lit: 0.5 } },
    { from: 5.5, to: 8.5, width: 3, height: 1.6, color: PALETTE.weatheredWood },
  ],
  hatches: { from: 15, to: 45, count: 4, width: 4.6, length: 3 },
  stacks: [],
  masts: [
    {
      at: 12,
      height: 22,
      rakeDeg: 3,
      radius: 0.3,
      gaff: { gooseneck: 1.5, boom: 10, gaff: 7, throat: 17.5, peakDeg: 30 },
    },
    {
      at: 27,
      height: 22,
      rakeDeg: 3.5,
      radius: 0.3,
      gaff: { gooseneck: 1.5, boom: 10, gaff: 7, throat: 17.5, peakDeg: 30 },
    },
    {
      at: 42,
      height: 20.5,
      rakeDeg: 4,
      radius: 0.28,
      gaff: { gooseneck: 1.5, boom: 13, gaff: 8, throat: 16, peakDeg: 28 },
    },
  ],
  sailsSet: true,
  jib: true,
  boats: [],
  lights: [
    { kind: 'port', at: 12.6, height: 2.2, x: 5.5 },
    { kind: 'starboard', at: 12.6, height: 2.2, x: 5.5 },
    { kind: 'stern', at: 60.5, height: 1.5 },
  ],
  paint: {
    topsides: PALETTE.hullBlack,
    boot: PALETTE.hullBlack,
    bottom: PALETTE.bootRed,
    rail: PALETTE.railWhite,
    bulwarkInside: PALETTE.railWhite,
    deck: PALETTE.deckWood,
    house: PALETTE.weatheredWood,
    roof: PALETTE.railWhite,
    hatch: PALETTE.weatheredWood,
    spar: PALETTE.sparBrown,
    canvas: PALETTE.canvas,
    rope: PALETTE.ink,
    smoke: PALETTE.coalSmoke,
  },
};

/**
 * Package steamer, 250 ft (`references/ferry.png`): a black hull under two tiers of white
 * cabins with rows of windows, the pilothouse forward on the upper tier, one tall stack.
 */
const PACKAGE_STEAMER: NpcShipLines = {
  id: 'ship.package_steamer',
  length: 76,
  beam: 11.6,
  draft: 3.6,
  freeboard: 2.3,
  sheerBow: 1.3,
  sheerStern: 0.5,
  bulwark: 1,
  stemRake: 0.6,
  transomRake: 2.2,
  transomWidth: 0.5,
  shape: {
    runEnd: 0.26,
    entranceStart: 0.66,
    sectionPower: 0.2,
    forefootStart: 0.88,
    levels: hullLevels(3.6, 2.3, -0.4, 0.3),
    bootBottom: -0.4,
    bootTop: 0.3,
  },
  houses: [
    { from: 9, to: 72, width: 10.8, height: 2.6, windows: { spacing: 1.6, lit: 0.75 } },
    { from: 15, to: 62, width: 8.4, height: 2.3, base: 2.6, windows: { spacing: 1.8, lit: 0.8 } },
    { from: 10.5, to: 15, width: 5, height: 2.5, base: 2.6, windows: { spacing: 1.1, lit: 1 } },
  ],
  stacks: [
    {
      at: 40,
      radius: 1.25,
      height: 8.5,
      base: 4.9,
      rakeDeg: 6,
      color: PALETTE.hullBlack,
      top: PALETTE.hullBlack,
    },
  ],
  masts: [
    { at: 5.5, height: 19, rakeDeg: 5, radius: 0.24 },
    { at: 66, height: 15, rakeDeg: 5, radius: 0.22 },
  ],
  sailsSet: false,
  boats: [
    { at: 24, length: 6, x: 3.1, base: 4.9 },
    { at: 53, length: 6, x: 3.1, base: 4.9 },
  ],
  lights: [
    { kind: 'masthead', at: 5.3, height: 14 },
    { kind: 'port', at: 13, height: 5.6, x: 2.7 },
    { kind: 'starboard', at: 13, height: 5.6, x: 2.7 },
    { kind: 'range', at: 65.8, height: 13 },
    { kind: 'stern', at: 75, height: 3 },
  ],
  paint: {
    topsides: PALETTE.hullBlack,
    boot: PALETTE.hullBlack,
    bottom: PALETTE.bootRed,
    rail: PALETTE.hullBlack,
    bulwarkInside: HOUSE,
    deck: PALETTE.deckWood,
    house: HOUSE,
    roof: PALETTE.weatheredWood,
    hatch: PALETTE.weatheredWood,
    spar: PALETTE.sparBrown,
    canvas: PALETTE.canvas,
    rope: PALETTE.ink,
    smoke: PALETTE.coalSmoke,
  },
};

/**
 * Fishing tug, 60 ft: a wooden steam tug of the Bayfield fisheries, its long white house
 * closed in against the spray, the pilothouse raised at its forward end, a short stack.
 */
const FISH_TUG: NpcShipLines = {
  id: 'ship.fish_tug',
  length: 18,
  beam: 4.8,
  draft: 1.7,
  freeboard: 1,
  sheerBow: 0.6,
  sheerStern: 0.15,
  bulwark: 0.5,
  stemRake: 0.5,
  transomRake: 0.7,
  transomWidth: 0.6,
  shape: {
    runEnd: 0.36,
    entranceStart: 0.5,
    sectionPower: 0.38,
    forefootStart: 0.72,
    levels: hullLevels(1.7, 1, -0.18, 0.22),
    bootBottom: -0.18,
    bootTop: 0.22,
  },
  houses: [
    { from: 3.6, to: 15.4, width: 3.7, height: 1.9, windows: { spacing: 1.2, lit: 0.6 } },
    { from: 3.9, to: 6.3, width: 2.8, height: 1.15, base: 1.9, windows: { spacing: 0.7, lit: 1 } },
  ],
  stacks: [
    {
      at: 8.2,
      radius: 0.36,
      height: 3.1,
      base: 1.9,
      rakeDeg: 6,
      color: PALETTE.hullBlack,
      top: PALETTE.hullBlack,
    },
  ],
  masts: [{ at: 2.2, height: 7, rakeDeg: 4, radius: 0.1 }],
  sailsSet: false,
  boats: [],
  lights: [
    { kind: 'masthead', at: 2.2, height: 5.6 },
    { kind: 'port', at: 5, height: 2.4, x: 1.6 },
    { kind: 'starboard', at: 5, height: 2.4, x: 1.6 },
    { kind: 'stern', at: 17.2, height: 1.6 },
  ],
  paint: {
    topsides: PALETTE.hullGreen,
    boot: PALETTE.hullBlack,
    bottom: PALETTE.bootRed,
    rail: PALETTE.railWhite,
    bulwarkInside: PALETTE.railWhite,
    deck: PALETTE.deckWood,
    house: HOUSE,
    roof: PALETTE.weatheredWood,
    hatch: PALETTE.weatheredWood,
    spar: PALETTE.sparBrown,
    canvas: PALETTE.canvas,
    rope: PALETTE.ink,
    smoke: PALETTE.coalSmoke,
  },
};

/**
 * The revenue cutter *Morrill*, 145 ft (R1): an iron steamer with a clipper bow and a
 * bowsprit, a schooner rig with its canvas furled, white hull, buff stack, a bow gun.
 */
const CUTTER_MORRILL: NpcShipLines = {
  id: 'ship.cutter_morrill',
  length: 44,
  beam: 7.3,
  draft: 2.8,
  freeboard: 1.6,
  sheerBow: 0.9,
  sheerStern: 0.4,
  bulwark: 0.85,
  stemRake: 2.6,
  transomRake: 1.6,
  transomWidth: 0.45,
  shape: {
    runEnd: 0.4,
    entranceStart: 0.5,
    sectionPower: 0.34,
    forefootStart: 0.68,
    levels: hullLevels(2.8, 1.6, -0.3, 0.25),
    bootBottom: -0.3,
    bootTop: 0.25,
  },
  bowsprit: { length: 6.5, steeveDeg: 10 },
  gun: { at: 4.5 },
  houses: [
    { from: 15, to: 27, width: 3.8, height: 2, color: PALETTE.stackBuff },
    { from: 12, to: 15.5, width: 3.2, height: 2.3, windows: { spacing: 0.8, lit: 1 } },
    { from: 31, to: 38, width: 3.4, height: 1.7, windows: { spacing: 1.2, lit: 0.6 } },
  ],
  stacks: [
    {
      at: 21,
      radius: 0.9,
      height: 6.8,
      base: 2,
      rakeDeg: 9,
      color: PALETTE.stackBuff,
      top: PALETTE.hullBlack,
    },
  ],
  masts: [
    {
      at: 9.5,
      height: 20,
      rakeDeg: 7,
      radius: 0.24,
      gaff: { gooseneck: 1.4, boom: 7, gaff: 5.5, throat: 15, peakDeg: 30 },
    },
    {
      at: 29.5,
      height: 19,
      rakeDeg: 7,
      radius: 0.24,
      gaff: { gooseneck: 1.4, boom: 11, gaff: 6, throat: 14.5, peakDeg: 28 },
    },
  ],
  sailsSet: false,
  boats: [{ at: 34.5, length: 5.5, x: 4.3, base: 1.2 }],
  lights: [
    { kind: 'masthead', at: 9.3, height: 13 },
    { kind: 'port', at: 13.5, height: 2.9, x: 1.8 },
    { kind: 'starboard', at: 13.5, height: 2.9, x: 1.8 },
    { kind: 'stern', at: 43.5, height: 1.8 },
  ],
  paint: {
    topsides: PALETTE.hullWhite,
    boot: PALETTE.hullBlack,
    bottom: PALETTE.bootRed,
    rail: PALETTE.sparBrown,
    bulwarkInside: PALETTE.railWhite,
    deck: PALETTE.deckWood,
    house: HOUSE,
    roof: PALETTE.weatheredWood,
    hatch: PALETTE.weatheredWood,
    spar: PALETTE.sparBrown,
    canvas: PALETTE.canvas,
    rope: PALETTE.ink,
    smoke: 0x4a4744,
  },
};

/** Every NPC class's lines, keyed by its ships.json `modelId`. */
export const NPC_LINES: Readonly<Record<string, NpcShipLines>> = Object.fromEntries(
  [ORE_FREIGHTER, SCHOONER_BARGE, PACKAGE_STEAMER, FISH_TUG, CUTTER_MORRILL].map((l) => [l.id, l]),
);

export function npcLines(modelId: string): NpcShipLines {
  const lines = NPC_LINES[modelId];
  if (!lines) throw new Error(`No NPC ship lines for ${modelId}`);
  return lines;
}
