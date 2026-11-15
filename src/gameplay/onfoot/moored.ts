import type { LootTable } from '../../../data/schemas/heist';
import type { ToolsFile } from '../../../data/schemas/tools';
import type { DistrictMark } from '../../../data/schemas/districts';
import type { Witness } from '../../sim/law/witness';
import type { DistrictModel } from '../district/district';
import { bearingBox } from './ashore-scene';
import type { BoxCollider } from './colliders';
import { withinHours } from './conduct';
import { nextDawn } from './foot-law';
import type { GuardSpawn } from './guards';
import type { NavQuery } from './nav';

/**
 * Ships moored in a docks district, and the whiskey trick on their crews (plan 08 §6.2,
 * §20.4 piece F, part two; Seavey's *Nellie Johnson* move).
 *
 * The lake's traffic lays its ships alongside the harbor's piers; the ones lying at a pier
 * of the district when you step ashore are **moored ships** here: a hull you walk round, a
 * **deck watch** (a sailor) posted on the pier at her gangway, and two things to be had
 * from the pier beside her: her **hold** (crates of what her manifest carries, one at a
 * time in your arms, as from a warehouse) and her **captain's cabin** (his cash box and her
 * papers, behind a lock).
 *
 * In the evening the rest of her crew is in the saloon. Stand them whiskey there (a bottle
 * for every few hands) and a bottle goes back aboard for the man on watch: he's drunk at
 * once and asleep within the hour, and her hold is yours for the night. Robbed sober, her
 * mate finds it at dawn like any burglary. Robbed drunk, the crew wake confused: the
 * report comes hours late and names nobody ("a friendly fellow with whiskey").
 *
 * Pure but for the district model it reads: `watch.ts` posts the sailors and hands the
 * containers to the heist, `ashore.ts` asks for the crew's prompt in the saloon.
 */

/** A ship lying at a pier, in the district's local meters. */
export interface MooredInput {
  id: string;
  name: string;
  /** "Fish tug". */
  className: string;
  owner: string | undefined;
  crew: number;
  cargo: readonly { good: string; qty: number }[];
  x: number;
  z: number;
  /** Radians clockwise from north (-z), local. */
  heading: number;
  lengthM: number;
  beamM: number;
}

export interface MooredShip extends MooredInput {
  /** The heist's "building" for her, and the key of her burglary: `ship.<id>`. */
  key: string;
  /** Where her deck watch stands on the pier, and the way he faces (out along it). */
  gangway: { x: number; y: number; z: number; face: number };
  /** Her hold's hatch and her cabin door as reached from the pier. */
  hold: { x: number; y: number; z: number };
  cabin: { x: number; y: number; z: number };
  /** Her hull: solid while she lies here. */
  hull: BoxCollider;
  /** The guard id of her deck watch. */
  watch: string;
}

/** The most ships with a deck watch at once: the guard budget is the district's first. */
export const MAX_MOORED = 2;
/** The deck watch stands this far off her side, on the pier. */
const GANGWAY_OFF_M = 1.3;
/** Her hold is reached this far forward of the gangway and her cabin this far aft. */
const HOLD_FORWARD_M = 2.4;
const CABIN_AFT_M = 2.4;

export function mooredKey(id: string): string {
  return `ship.${id.replace(/^ship\./, '')}`;
}

/**
 * Her name in a sentence: "the supply tug Wren" from the traffic's "Supply tug Wren" (the
 * papers' style), "the Emma" from a bare name.
 */
export function shipWords(s: { name: string }): string {
  if (/^the /i.test(s.name)) return s.name;
  const classed = /\s/.test(s.name.trim());
  return `the ${classed ? s.name.charAt(0).toLowerCase() + s.name.slice(1) : s.name}`;
}

/**
 * Sets the ships down in the district: the pier side each lies against (the side with a
 * dry deck a guard can stand on), her gangway there, and her hold and cabin either hand of
 * it. A ship with no pier beside her inside the district is left out.
 */
export function placeMoored(
  model: DistrictModel,
  nav: NavQuery,
  ships: readonly MooredInput[],
): MooredShip[] {
  const dry = (x: number, z: number): boolean =>
    model.floorAt(x, z) > model.waterLevel + 0.6 && nav.walkable({ x, z });
  const out: MooredShip[] = [];
  for (const s of [...ships].sort((a, b) => a.id.localeCompare(b.id))) {
    if (out.length >= MAX_MOORED) break;
    // Along her keel (bow), and to starboard.
    const ax = Math.sin(s.heading);
    const az = -Math.cos(s.heading);
    const nx = -az;
    const nz = ax;
    let found: { x: number; z: number; side: number; along: number } | undefined;
    // Amidships first, then toward either end: a long ship overhangs a short pier.
    search: for (const along of [0, -0.15, 0.15, -0.3, 0.3, -0.42, 0.42]) {
      for (const side of [1, -1]) {
        for (const off of [GANGWAY_OFF_M, GANGWAY_OFF_M + 0.8, GANGWAY_OFF_M + 1.6]) {
          const d = s.beamM / 2 + off;
          const x = s.x + ax * along * s.lengthM + nx * side * d;
          const z = s.z + az * along * s.lengthM + nz * side * d;
          if (dry(x, z)) {
            found = { x, z, side, along };
            break search;
          }
        }
      }
    }
    if (!found) continue;
    const spot = (alongM: number): { x: number; y: number; z: number } => {
      // Slide back toward the gangway until there's pier underfoot.
      for (const k of [1, 0.6, 0.3, 0]) {
        const x = found.x + ax * alongM * k;
        const z = found.z + az * alongM * k;
        if (k === 0 || dry(x, z)) return { x, y: model.floorAt(x, z), z };
      }
      return { x: found.x, y: model.floorAt(found.x, found.z), z: found.z };
    };
    const key = mooredKey(s.id);
    out.push({
      ...s,
      key,
      // He looks out across the pier, his back to his ship.
      gangway: {
        x: found.x,
        y: model.floorAt(found.x, found.z),
        z: found.z,
        face: Math.atan2(nx * found.side, -(nz * found.side)),
      },
      hold: spot(HOLD_FORWARD_M),
      cabin: spot(-CABIN_AFT_M),
      hull: bearingBox(s.x, s.z, s.heading, s.beamM, s.lengthM, -2.5, 2.6, 'wood'),
      watch: `sailor.${key}`,
    });
  }
  return out;
}

/** Her deck watch: a sailor on the pier at her gangway. */
export function deckWatch(s: MooredShip): GuardSpawn {
  const g = s.gangway;
  return {
    id: s.watch,
    type: 'npc.sailor',
    name: `${shipWords(s)}'s deck watch`,
    route: { points: [{ x: g.x, z: g.z, face: g.face, waitS: 30 }], loop: true },
  };
}

/** Her hold as a loot table: crates of each good she carries, as many as come up a hatch. */
export function holdTable(s: MooredShip, rules: ToolsFile): LootTable {
  const most = rules.whiskey.trick.holdCrates;
  return {
    id: `loot.${s.key.replace(/[^a-z0-9_]/g, '_')}_hold`,
    name: `${shipWords(s)}'s hold`,
    crates: s.cargo
      .filter((c) => c.qty >= 1)
      .map((c) => {
        const n = Math.min(most, Math.floor(c.qty));
        return { good: c.good, min: n, max: n };
      }),
    cashCents: [0, 0],
    documents: 0,
  };
}

/** Her captain's cabin: his cash box, by the size of her crew, and her papers. */
export function cabinTable(s: MooredShip, rules: ToolsFile): LootTable {
  const t = rules.whiskey.trick;
  const hands = Math.max(1, s.crew);
  return {
    id: `loot.${s.key.replace(/[^a-z0-9_]/g, '_')}_cabin`,
    name: `${shipWords(s)}'s cabin`,
    crates: [],
    cashCents: [t.cabinCashPerHandCents[0] * hands, t.cabinCashPerHandCents[1] * hands],
    documents: t.cabinPapers,
  };
}

/** Bottles to stand her crew: one for every few hands, fewer for a saloon keeper. */
export function bottlesFor(crew: number, rules: ToolsFile, perk: boolean): number {
  const t = rules.whiskey.trick;
  const per = t.crewPerBottle * (perk ? 2 : 1);
  return Math.max(1, Math.min(t.maxBottles, Math.ceil(Math.max(1, crew) / per)));
}

/** Whether her crew is ashore drinking at this hour. */
export function crewInSaloon(hour: number, rules: ToolsFile): boolean {
  return withinHours(hour, rules.whiskey.trick.saloonHours);
}

/** A crew stood whiskey tonight (the save's record). */
export interface CrewDrunk {
  /** The night it was (`heist.nightOf`). */
  night: number;
  /** Game seconds the deck watch is asleep by. */
  passOutAt: number;
}

/**
 * Who reports her robbed (plan 08 §6.2 step 4): sober, her mate at dawn, as any owner
 * finds a burglary; drunk on your whiskey, her crew when their heads clear, hours late.
 * Either way nobody saw who: a watch who did see you is his own witness, and names you.
 */
export function crewEvidence(
  s: MooredShip,
  gameSeconds: number,
  drunk: boolean,
  rules: ToolsFile,
): Witness {
  const dawn = nextDawn(gameSeconds);
  return {
    id: `evidence.${s.key}`,
    kind: 'sailor',
    name: drunk
      ? `${shipWords(s)}'s crew, sore-headed, of a friendly fellow with whiskey`
      : `${shipWords(s)}'s mate`,
    identification: 'unknown',
    reportAt: drunk ? dawn + rules.whiskey.trick.lateReportH * 3600 : dawn,
  };
}

/** Where a crew stands in the saloon: the layout's `crew` marks, a ship to each in turn. */
export function crewTables(
  marks: readonly DistrictMark[],
  ships: readonly MooredShip[],
): { mark: DistrictMark; ship: MooredShip }[] {
  const tables = marks.filter((m) => m.kind === 'crew').sort((a, b) => a.id.localeCompare(b.id));
  const out: { mark: DistrictMark; ship: MooredShip }[] = [];
  ships.forEach((ship, k) => {
    const mark = tables[k];
    if (mark) out.push({ mark, ship });
  });
  return out;
}

/** The figures round a crew's table: two or three hands, a step off the mark. */
export function crewFigures(
  mark: DistrictMark,
  ship: MooredShip,
): { id: string; x: number; z: number; heading: number }[] {
  const n = Math.max(1, Math.min(3, ship.crew - 1));
  const out: { id: string; x: number; z: number; heading: number }[] = [];
  for (let k = 0; k < n; k++) {
    const a = (mark.headingDeg * Math.PI) / 180 + (k * Math.PI * 2) / 3;
    const x = mark.x + Math.sin(a) * 1.15;
    const z = mark.z - Math.cos(a) * 1.15;
    // Each faces the table.
    out.push({ id: `crew:${ship.key}:${k}`, x, z, heading: a + Math.PI });
  }
  return out;
}
