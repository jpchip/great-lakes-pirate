import { DEFAULT_COMPRESSION, type Chart } from '../../core/coords';
import { distance } from '../chart/geography';
import type { Contact, ContactKind, Encounter } from '../chart/traffic';

/**
 * What an open-water arena is built from (plan 03 §6.3, Phase 3 piece G): where on the
 * chart the player left it, which way they were going, and who or what they met. The
 * chart (piece D) hands one in when the player engages or is forced; traffic (piece F)
 * fills `ships` from its abstract ships on their lanes. Plain data, so it unit-tests.
 */

/** What was met. `ship` covers every traffic class; the cutter, wrecks and weather differ. */
export type ArenaKind = 'ship' | 'cutter' | 'derelict' | 'squall' | 'fogbank';

/** One ship to materialize in the arena, from its abstract state on the chart. */
export interface ArenaShip {
  /** The traffic entity's stable id (the chart contact's id). */
  id: string;
  /** ships.json class. */
  classId: string;
  name: string;
  /** Course over the ground on the chart: its lane's heading. Radians clockwise from north. */
  heading: number;
  /** Game knots; 0 for a derelict. */
  speedKn: number;
  /**
   * Where it sits relative to the arena's centre, zone meters. Omitted for the met ship,
   * which goes in the middle.
   */
  offset?: { x: number; z: number };
  /** The cutter: it may hunt the player (piece F's dev flag until Phase 5's Wanted). */
  hostile?: boolean;
  /** A wreck: no way on, no lamps, no smoke, listing. */
  derelict?: boolean;
}

export interface ArenaEncounter {
  /** The chart contact's id; the chart marks it handled when the arena ends. */
  contactId: string;
  kind: ArenaKind;
  /** Where the player left the chart (§20.5: and where they go back to). */
  at: Chart;
  /** The player's heading and speed on the chart, so the arena starts as they sailed. */
  playerHeading: number;
  /** Bearing from the player to what was met, radians. */
  bearing: number;
  /** A hostile closed on you: no choice but the arena. */
  forced: boolean;
  ships: ArenaShip[];
  /** The cutter hunts you (dev flag `?cutter=hunt` until Phase 5). */
  hunting: boolean;
  /**
   * The squall or fog bank met, as the weather sim has it (Phase 3 piece E): its centre on
   * the chart and its radius (a fog bank's wall). The arena samples the sim so that it
   * stands where it should around the player. Without it (the `?encounter=` checks) the
   * arena stands one up for the look.
   */
  weather?: { center: Chart; radiusM: number };
}

/** The ships.json class each S8 contact kind is drawn as. */
export const CONTACT_CLASS: Readonly<Record<Exclude<ContactKind, 'storm' | 'fog'>, string>> = {
  freighter: 'ship.ore_freighter',
  steamer: 'ship.package_steamer',
  barge: 'ship.schooner_barge',
  tug: 'ship.fish_tug',
  cutter: 'ship.cutter_morrill',
  // A wrecked schooner-barge, the commonest loss on the lake in 1900.
  derelict: 'ship.schooner_barge',
};

/** A consort rides her towline this far astern, zone meters. */
export const CONSORT_ASTERN_M = 260;
/** Other traffic within this much of what was met comes into the arena with it, zone meters. */
export const COMPANY_RANGE_M = 1200;
/** At most this many ships in an arena (the five-ship draw-call budget, piece H). */
export const MAX_ARENA_SHIPS = 5;

/** Zone-meter offset `m` astern of a ship on `heading`. */
function astern(heading: number, m: number): { x: number; z: number } {
  return { x: -Math.sin(heading) * m, z: Math.cos(heading) * m };
}

function shipFrom(c: Contact, offset?: { x: number; z: number }): ArenaShip {
  const derelict = c.kind === 'derelict';
  const kind = c.kind === 'storm' || c.kind === 'fog' ? 'derelict' : c.kind;
  return {
    id: c.id,
    classId: c.classId ?? CONTACT_CLASS[kind],
    name: c.name,
    heading: c.heading,
    // A tug lying on her nets, or a ship at anchor, has no way on.
    speedKn: derelict || c.underWay === false ? 0 : c.speedKn,
    ...(offset ? { offset } : {}),
    ...(c.hostile ? { hostile: true } : {}),
    ...(derelict ? { derelict: true } : {}),
  };
}

/** A ship and her consorts in tow, `at` the ship's own offset (undefined for the middle). */
function withConsorts(c: Contact, at?: { x: number; z: number }): ArenaShip[] {
  const out = [shipFrom(c, at)];
  (c.consorts ?? []).forEach((consort, i) => {
    const back = astern(c.heading, CONSORT_ASTERN_M * (i + 1));
    out.push({
      id: `${c.id}.consort_${i + 1}`,
      classId: consort.classId,
      name: consort.name,
      heading: c.heading,
      speedKn: c.underWay === false ? 0 : c.speedKn,
      offset: { x: (at?.x ?? 0) + back.x, z: (at?.z ?? 0) + back.z },
    });
  });
  return out;
}

/**
 * The arena for a chart encounter. `heading` is the player's on the chart. Traffic
 * (piece F) brings the ship met with her consorts, and any other ship on the water near
 * her (`company`, the chart's contacts) at its place relative to her, nearest first, up
 * to the five-ship budget.
 */
export function arenaFromChartEncounter(
  enc: Encounter,
  at: Chart,
  heading: number,
  options: { hunting?: boolean; classId?: string; company?: readonly Contact[] } = {},
): ArenaEncounter {
  const c: Contact = enc.contact;
  const base = {
    contactId: c.id,
    at: { ...at },
    playerHeading: heading,
    bearing: enc.bearing,
    forced: enc.forced,
    hunting: options.hunting ?? false,
  };
  if (c.kind === 'storm' || c.kind === 'fog') {
    return {
      ...base,
      kind: c.kind === 'storm' ? 'squall' : 'fogbank',
      ships: [],
      weather: { center: { ...c.pos }, radiusM: c.radiusM ?? 0 },
    };
  }
  const derelict = c.kind === 'derelict';
  const ships = withConsorts(c);
  if (options.classId) (ships[0] as ArenaShip).classId = options.classId;
  const reach = COMPANY_RANGE_M * DEFAULT_COMPRESSION;
  const near = (options.company ?? [])
    .filter((o) => o.id !== c.id && o.kind !== 'storm' && !o.inPort)
    .map((o) => ({ o, d: distance(o.pos, c.pos) }))
    .filter(({ d }) => d <= reach)
    .sort((a, b) => a.d - b.d);
  for (const { o } of near) {
    // Chart meters to zone meters about the ship met (east is +x, north is -z).
    const offset = {
      x: (o.pos.x - c.pos.x) / DEFAULT_COMPRESSION,
      z: -(o.pos.y - c.pos.y) / DEFAULT_COMPRESSION,
    };
    const group = withConsorts(o, offset);
    if (ships.length + group.length > MAX_ARENA_SHIPS) continue;
    ships.push(...group);
  }
  return {
    ...base,
    kind: c.kind === 'cutter' ? 'cutter' : derelict ? 'derelict' : 'ship',
    ships,
  };
}

/** The `?encounter=<kind>` checks (§20.3 criterion 5): each class, the cutter, a wreck, weather. */
export const DEV_ENCOUNTERS = [
  'freighter',
  'barge',
  'steamer',
  'tug',
  'cutter',
  'derelict',
  'squall',
  'fogbank',
  'convoy',
] as const;
export type DevEncounterId = (typeof DEV_ENCOUNTERS)[number];

export function isDevEncounter(id: string | null): id is DevEncounterId {
  return id !== null && (DEV_ENCOUNTERS as readonly string[]).includes(id);
}

const DEV_SHIPS: Readonly<Record<string, { classId: string; name: string; speedKn: number }>> = {
  freighter: { classId: 'ship.ore_freighter', name: 'Ore boat Manola', speedKn: 10 },
  barge: { classId: 'ship.schooner_barge', name: 'Schooner-barge Grampian', speedKn: 7 },
  steamer: { classId: 'ship.package_steamer', name: 'Steamer Hiram R. Dixon', speedKn: 11 },
  tug: { classId: 'ship.fish_tug', name: 'Fish tug Ella G.', speedKn: 8 },
  cutter: { classId: 'ship.cutter_morrill', name: 'Revenue cutter Morrill', speedKn: 12 },
  derelict: { classId: 'ship.schooner_barge', name: 'Wreck of the Pretoria', speedKn: 0 },
};

/** Open water on the Bayfield–Duluth track, the North Shore in view: the default check point. */
export const DEV_ARENA_AT_GEO = { lat: 47.05, lon: -91.3 } as const;

/**
 * A hand-made encounter for checks: what was met crossing the player's bow from
 * starboard, 30° off it, the way the S8 lookouts usually report traffic. `convoy` is a
 * steam freighter towing a schooner-barge consort with a tug in company, three ships at
 * once, for the five-ship draw-call budget.
 */
export function devEncounter(
  id: DevEncounterId,
  at: Chart,
  heading: number,
  hunting = false,
): ArenaEncounter {
  const bearing = heading + Math.PI / 6;
  const crossing = heading - Math.PI / 2;
  const base = {
    contactId: `dev.${id}`,
    at: { ...at },
    playerHeading: heading,
    bearing,
    forced: id === 'cutter' && hunting,
    hunting,
  };
  if (id === 'squall') return { ...base, kind: 'squall', ships: [] };
  if (id === 'fogbank') return { ...base, kind: 'fogbank', ships: [] };
  if (id === 'convoy') {
    return {
      ...base,
      kind: 'ship',
      ships: [
        { id: 'dev.convoy.freighter', ...shipOf('freighter'), heading: crossing, speedKn: 8 },
        // The consort on her towline, a few hundred meters astern.
        {
          id: 'dev.convoy.barge',
          ...shipOf('barge'),
          heading: crossing,
          speedKn: 8,
          offset: astern(crossing, CONSORT_ASTERN_M),
        },
        {
          id: 'dev.convoy.tug',
          ...shipOf('tug'),
          heading: crossing + Math.PI,
          speedKn: 8,
          offset: { x: 420, z: -520 },
        },
      ],
    };
  }
  const ship = shipOf(id);
  return {
    ...base,
    kind: id === 'cutter' ? 'cutter' : id === 'derelict' ? 'derelict' : 'ship',
    ships: [
      {
        id: `dev.${id}`,
        ...ship,
        heading: id === 'cutter' && hunting ? bearing + Math.PI : crossing,
        ...(id === 'cutter' ? { hostile: true } : {}),
        ...(id === 'derelict' ? { derelict: true } : {}),
      },
    ],
  };
}

function shipOf(id: string): { classId: string; name: string; speedKn: number } {
  const ship = DEV_SHIPS[id];
  if (!ship) throw new Error(`No dev ship ${id}`);
  return ship;
}
