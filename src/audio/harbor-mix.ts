import type { BuildingKind, PierDef } from '../../data/schemas/harbors';

/**
 * Harbor work (plan 15 §4.1 "Docks at day", Phase 4 piece J): which harbors are at work,
 * when, and how far it carries. Pure numbers from the harbors' buildings and piers, the
 * hour, the month and the weather, so the rules are tested without Web Audio;
 * harbor-audio.ts turns them into one-shots placed at the sites.
 *
 * Distances are zone meters (the harbors are 1:1, the open water between is compressed),
 * so the ranges are set by ear like the fog signals', not from real acoustics.
 */

const clamp01 = (v: number): number => Math.min(Math.max(v, 0), 1);
const smooth = (t: number): number => {
  const c = clamp01(t);
  return c * c * (3 - 2 * c);
};

/**
 * The kinds of work heard from the water: a sawmill's head saw, caulking mallets at a
 * shipyard, a cooper's hammer on the hoops, ore cars dumping into an ore dock's pockets,
 * and the railroad switching cars along the docks and at the depot (the couplings banging
 * as the slack runs out of a train).
 */
export const WORK_KINDS = ['saw', 'caulking', 'cooper', 'ore', 'yard'] as const;
export type WorkKind = (typeof WORK_KINDS)[number];

/** Which work a building does; most buildings are quiet from the water. */
export const BUILDING_WORK: Partial<Record<BuildingKind, WorkKind>> = {
  sawmill: 'saw',
  shipShed: 'caulking',
  cooperage: 'cooper',
  depot: 'yard',
};

/** Which work a pier does: ore docks dump cars, ore and coal docks switch them. */
export const PIER_WORK: Partial<Record<PierDef['kind'], readonly WorkKind[]>> = {
  ore: ['ore', 'yard'],
  coal: ['yard'],
};

export interface WorkRule {
  /** Where it's full, and how far it carries before it's gone, zone meters. */
  refM: number;
  rangeM: number;
  /** Events a second while at work: a cut, a burst of blows, a car dumped, a switch. */
  perS: number;
  /** Working hours, local, [from, to); `to` past 24 runs through midnight. */
  hours: readonly [number, number];
  /** A dinner break with the yard quiet, hours [from, to). */
  dinner?: readonly [number, number];
  /** Months worked, 0 = January, inclusive: the mills and the docks keep the season. */
  months: readonly [number, number];
  /** Outdoor work stops in a downpour or a storm. */
  outdoors: boolean;
}

/**
 * The 1900 waterfront's hours: the mills ran a ten- or eleven-hour day through the sawing
 * season, the shipyard and the cooper kept daylight hours with an hour off at noon, the
 * ore docks loaded around the clock in the shipping season under their lamps, and the
 * railroad switched from early to late.
 */
export const WORK: Readonly<Record<WorkKind, WorkRule>> = {
  saw: { refM: 120, rangeM: 1900, perS: 1 / 14, hours: [6, 18], months: [4, 10], outdoors: false },
  caulking: {
    refM: 60,
    rangeM: 900,
    perS: 1 / 7,
    hours: [7, 17.5],
    dinner: [12, 13],
    months: [3, 10],
    outdoors: true,
  },
  cooper: {
    refM: 50,
    rangeM: 700,
    perS: 1 / 9,
    hours: [7, 17.5],
    dinner: [12, 13],
    months: [3, 10],
    outdoors: false,
  },
  ore: { refM: 150, rangeM: 2300, perS: 1 / 35, hours: [0, 24], months: [3, 11], outdoors: false },
  yard: { refM: 100, rangeM: 1600, perS: 1 / 55, hours: [5, 22], months: [0, 11], outdoors: true },
};

/** 0–1: how busy work of `kind` is at this hour, month and weather (eased at the edges). */
export function workActivity(
  kind: WorkKind,
  hour: number,
  month0: number,
  rain01 = 0,
  storm01 = 0,
): number {
  const rule = WORK[kind];
  if (month0 < rule.months[0] || month0 > rule.months[1]) return 0;
  const [from, to] = rule.hours;
  // A quarter hour to get going and to knock off.
  const day = to - from >= 24 ? 1 : smooth((hour - from) / 0.25) * smooth((to - hour) / 0.25);
  const dinner = rule.dinner
    ? 1 - smooth((hour - rule.dinner[0]) / 0.1) * smooth((rule.dinner[1] - hour) / 0.1)
    : 1;
  const weather = rule.outdoors
    ? clamp01(1 - (rain01 - 0.5) / 0.3) * clamp01(1 - storm01 / 0.4)
    : 1;
  return day * dinner * weather;
}

/**
 * How loud and bright work of `kind` is `distanceM` away, or undefined past its range: a
 * little slower than inverse distance, faded over the last fifth of the range, and duller
 * with distance, more so in fog (`damping`, plan 15 §7).
 */
export function workLevel(
  kind: WorkKind,
  distanceM: number,
  damping = 1,
): { gain: number; lowpassHz: number } | undefined {
  const { refM, rangeM } = WORK[kind];
  if (distanceM >= rangeM) return undefined;
  const d = Math.max(distanceM, refM);
  const edge = smooth((rangeM - distanceM) / (0.2 * rangeM));
  return {
    gain: (refM / d) ** 0.9 * edge,
    lowpassHz: Math.max(500, 14000 * (refM / d) ** 0.65 * damping),
  };
}

/** A work site placed in the zone: where the sound comes from. */
export interface WorkSite {
  id: string;
  kind: WorkKind;
  x: number;
  y: number;
  z: number;
}

/** The pieces of a harbor layout the work sites come from. */
export interface WorkHarbor {
  id: string;
  buildings: readonly {
    kind: BuildingKind;
    x: number;
    z: number;
    floorM: number;
    heightM: number;
  }[];
  piers: readonly {
    kind: PierDef['kind'];
    root: { x: number; z: number };
    /** Radians clockwise from north; the deck reaches `lengthM` out, ashore up to `shoreM`. */
    bearing: number;
    shoreM: number;
    lengthM: number;
    deckM: number;
  }[];
}

/** Every place in the zone's harbors that is heard at work. */
export function workSites(harbors: readonly WorkHarbor[]): WorkSite[] {
  const out: WorkSite[] = [];
  for (const h of harbors) {
    h.buildings.forEach((b, i) => {
      const kind = BUILDING_WORK[b.kind];
      if (kind) {
        out.push({ id: `${h.id}#b${i}`, kind, x: b.x, y: b.floorM + 0.5 * b.heightM, z: b.z });
      }
    });
    h.piers.forEach((p, i) => {
      for (const kind of PIER_WORK[p.kind] ?? []) {
        // Cars dump along the trestle's top; the switching is where the tracks come ashore.
        const along = p.shoreM + (p.lengthM - p.shoreM) * (kind === 'ore' ? 0.55 : 0.1);
        out.push({
          id: `${h.id}#p${i}.${kind}`,
          kind,
          x: p.root.x + Math.sin(p.bearing) * along,
          y: p.deckM,
          z: p.root.z - Math.cos(p.bearing) * along,
        });
      }
    });
  }
  return out;
}
