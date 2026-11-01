import type { PierDef } from '../../../data/schemas/harbors';
import type { ShipRecord } from '../../../data/schemas/ships';
import type { Pose } from '../terrain/test-bay';
import { dockPoint } from '../terrain/test-bay';
import type { HarborLayout, PlacedPier } from '../harbors';

/**
 * Where the traffic lies in port (plan 01 §3.4; Phase 4 piece D). A ship in port at a
 * harbor in the loaded zone lies alongside one of its piers: the ore boats at the ore dock,
 * the barges at the mill, the steamers at the city dock, the tugs at the fish dock. Each
 * pier side holds one ship. The player's own berths on a side a ship takes are withdrawn
 * while she's there, and the city dock's north side is always kept for the player.
 *
 * Zone meters, x east, z south; headings clockwise from north.
 */

/** Pier kinds a class lies at, best first. */
export const PIER_PREFERENCE: Readonly<Record<string, readonly PierDef['kind'][]>> = {
  'ship.ore_freighter': ['ore', 'coal', 'lumber', 'city'],
  'ship.schooner_barge': ['lumber', 'coal', 'city', 'fish'],
  'ship.package_steamer': ['city', 'lumber', 'coal'],
  'ship.fish_tug': ['fish', 'city', 'lumber'],
  'ship.cutter_morrill': ['city', 'fish', 'lumber'],
};

/** A pier side: +1 is the side the berth ids call `south`, −1 `north` (`dockBerths`). */
export type PierSide = 1 | -1;

export interface NpcBerth {
  pierId: string;
  side: PierSide;
  pose: Pose;
}

/** What the berth layout reads of the terrain. */
export interface BerthTerrain {
  depthAt(x: number, z: number): number;
}

/** Water a ship needs under her keel at a berth, beyond her loaded draft. */
const BERTH_UNDER_KEEL_M = 0.3;
/** Room between the pier's face and her side. */
const BERTH_FENDER_M = 0.8;
/** No ship's stern comes closer than this to where the deck meets the land. */
const SHORE_CLEAR_M = 4;

/** A ship's length and beam as drawn in the zone, meters. */
export function drawnSize(record: ShipRecord): { lengthM: number; beamM: number } {
  const lengthM = record.lengthM * record.displayScale;
  return { lengthM, beamM: Math.max(lengthM * 0.16, 4.5) };
}

/**
 * A ship's pose alongside one side of a pier, bow out: centred on the pier when she fits,
 * otherwise reaching out past its end. Undefined when the water at her bow, waist or stern
 * is too shallow for her draft.
 */
export function berthPose(
  pier: PlacedPier,
  record: ShipRecord,
  side: PierSide,
  terrain: BerthTerrain | undefined,
): Pose | undefined {
  if (pier.berths === false) return undefined;
  const { lengthM, beamM } = drawnSize(record);
  const along = Math.max(pier.lengthM - lengthM / 2, pier.shoreM + SHORE_CLEAR_M + lengthM / 2);
  const across = side * (pier.widthM / 2 + beamM / 2 + BERTH_FENDER_M);
  if (terrain) {
    for (const k of [-0.45, 0, 0.45]) {
      const p = dockPoint(pier, along + k * lengthM, across);
      if (terrain.depthAt(p.x, p.z) < record.draftFullM + BERTH_UNDER_KEEL_M) return undefined;
    }
  }
  const c = dockPoint(pier, along, across);
  return { x: c.x, z: c.z, heading: pier.bearing };
}

/** The harbor that serves a port: `port.bayfield` lies at `harbor.bayfield`. */
export function harborForPort(
  layouts: readonly HarborLayout[],
  port: string,
): HarborLayout | undefined {
  const id = `harbor.${port.replace(/^port\./, '')}`;
  return layouts.find((l) => l.def.id === id);
}

/** The player's berth ids on a pier side, as `dockBerths` names them. */
export function sideOfBerth(berthId: string): { pierId: string; side: PierSide } | undefined {
  const m = /^(.*)\.(north|south)\d*$/.exec(berthId);
  if (!m?.[1]) return undefined;
  return { pierId: m[1], side: m[2] === 'south' ? 1 : -1 };
}

const slotKey = (pierId: string, side: PierSide): string => `${pierId}|${side}`;

/**
 * Lays the ships in port at a harbor alongside its piers, in the order given (keep it
 * stable so a ship doesn't jump piers as others come and go). `taken` are pier sides
 * already held, such as the player's. Ships with no room left lie out of sight.
 */
export function assignBerths(
  layout: HarborLayout,
  ships: readonly { id: string; record: ShipRecord }[],
  terrain: BerthTerrain | undefined,
  taken: ReadonlySet<string> = new Set(),
): Map<string, NpcBerth> {
  const used = new Set(taken);
  const city = layout.piers.find((p) => p.kind === 'city');
  if (city) used.add(slotKey(city.id, -1));
  const out = new Map<string, NpcBerth>();
  for (const ship of ships) {
    const kinds = PIER_PREFERENCE[ship.record.id] ?? ['city'];
    search: for (const kind of kinds) {
      for (const pier of layout.piers) {
        if (pier.kind !== kind) continue;
        for (const side of [1, -1] as const) {
          if (used.has(slotKey(pier.id, side))) continue;
          const pose = berthPose(pier, ship.record, side, terrain);
          if (!pose) continue;
          used.add(slotKey(pier.id, side));
          out.set(ship.id, { pierId: pier.id, side, pose });
          break search;
        }
      }
    }
  }
  return out;
}

/** Pier-side key for a set of taken sides. */
export function pierSideKey(pierId: string, side: PierSide): string {
  return slotKey(pierId, side);
}
