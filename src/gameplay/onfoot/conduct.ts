import type { DistrictLayoutFile } from '../../../data/schemas/districts';
import type { ToolsFile } from '../../../data/schemas/tools';
import { daylight01, type SkyLight } from '../../sim/law/perception';
import type { Gait } from './controller';
import type { XZ } from './nav';

/**
 * Conduct (plan 08 §2.3, §4; Phase 7 piece E): whether being seen here and now is
 * suspicious, and why. A guard who sees you going about your business thinks nothing of
 * it; one who sees you doing something you shouldn't fills his meter to the alarm. This is
 * the `suspect` input to the guards (`StealthInputs`), with the reason the HUD shows, so
 * you can always tell what a guard would make of you (plan 08 §20.3 #2).
 *
 * In order, the first that holds is the reason:
 * - carrying a man (a body or a man out cold), day or night;
 * - a cosh or a knife in your hand, day or night;
 * - carrying loot (piece E's crates and pockets, when they land);
 * - inside a private building or yard, or a shop outside its hours: trespass;
 * - out in an area that shuts at night, after dark;
 * - sneaking about, day or night; running, or swimming in the harbor, at night.
 *
 * By day in the street, walking, nothing is suspicious; at night the street is still public,
 * so walking back to your ship along the wharf is fine. Being known by face at Wanted tier
 * 2+ is the guards' own rule (stealth.ts) and needs no conduct.
 */

export type ConductReason =
  'body' | 'armed' | 'loot' | 'trespass' | 'afterHours' | 'skulking' | 'running' | 'swimming';

export const CONDUCT_WORDS: Record<ConductReason, string> = {
  body: 'Carrying a man',
  armed: 'Weapon in hand',
  loot: 'Carrying loot',
  trespass: 'Trespassing',
  afterHours: 'Out after hours',
  skulking: 'Skulking',
  running: 'Running at night',
  swimming: 'Swimming at night',
};

/** An area of the district and who may be in it when. */
export interface ConductArea {
  id: string;
  name?: string;
  /**
   * `private`: always trespass (a warehouse, a house, a yard, someone else's ship).
   * `shop`: open inside `hours`, trespass outside them. `closedAtNight`: public by day only.
   */
  kind: 'private' | 'shop' | 'closedAtNight';
  /** Opening hours for a shop, `[from, to]`; `to` below `from` runs past midnight. */
  hours?: readonly [number, number];
}

/** Where the areas are: the district answers for a point. */
export interface ConductMap {
  areaAt(x: number, z: number): ConductArea | undefined;
}

export interface Conduct {
  suspect: boolean;
  reason: ConductReason | undefined;
  /** What the HUD says, empty when nothing's amiss. */
  words: string;
  /** The area you're in, if any. */
  area: ConductArea | undefined;
}

export interface ConductInputs {
  at: XZ;
  gait: Gait;
  crouching: boolean;
  swimming: boolean;
  /** The game's hour of the day, 0–24. */
  hour: number;
  night: boolean;
  carryingBody?: boolean;
  carryingLoot?: boolean;
  /** A drawn tool (cosh, knife) is in hand. */
  armed?: boolean;
}

/** Night for conduct: the guards' own day test (daylight under half). */
export function isNight(sky: SkyLight): boolean {
  return daylight01(sky.sunElevationRad) <= 0.5;
}

/** Whether an hour falls in `[from, to)`, wrapping past midnight. */
export function withinHours(hour: number, hours: readonly [number, number]): boolean {
  const h = ((hour % 24) + 24) % 24;
  const [from, to] = hours;
  return from <= to ? h >= from && h < to : h >= from || h < to;
}

function areaReason(area: ConductArea | undefined, hour: number, night: boolean) {
  if (!area) return undefined;
  switch (area.kind) {
    case 'private':
      return 'trespass' as const;
    case 'shop':
      return area.hours && withinHours(hour, area.hours) ? undefined : ('trespass' as const);
    case 'closedAtNight':
      return night ? ('afterHours' as const) : undefined;
  }
}

export function conduct(map: ConductMap, i: ConductInputs): Conduct {
  const area = map.areaAt(i.at.x, i.at.z);
  const reason: ConductReason | undefined = i.carryingBody
    ? 'body'
    : i.armed
      ? 'armed'
      : i.carryingLoot
        ? 'loot'
        : (areaReason(area, i.hour, i.night) ??
          (i.crouching || i.gait === 'sneak'
            ? 'skulking'
            : i.night && i.gait === 'run'
              ? 'running'
              : i.night && i.swimming
                ? 'swimming'
                : undefined));
  return {
    suspect: reason !== undefined,
    reason,
    words: reason ? CONDUCT_WORDS[reason] : '',
    area,
  };
}

// ---------------------------------------------------------------------------------------
// Maps.

export interface Rect {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/** Areas as rectangles (the greybox; a later district's yards). The first that holds wins. */
export function rectConductMap(areas: readonly (ConductArea & { rect: Rect })[]): ConductMap {
  return {
    areaAt(x, z) {
      for (const a of areas) {
        const r = a.rect;
        if (x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ) return a;
      }
      return undefined;
    },
  };
}

/**
 * A district layout's areas (piece C's `data/districts/*.json`): every building is private
 * but the shops, which are open in `tools.json`'s hours for the tab their door opens. The
 * wharves and the street are public day and night (your own ship is moored there).
 */
export function layoutConductMap(layout: DistrictLayoutFile, rules: ToolsFile): ConductMap {
  const cell = layout.cellM;
  const { x0, z0 } = layout.bounds;
  const areas = new Map<string, ConductArea>();
  const byCell = new Map<number, ConductArea>();
  const key = (c: number, r: number) => c * 4096 + r;
  for (const b of layout.buildings) {
    const hours = b.opens ? rules.conduct.hours[b.opens] : undefined;
    const area: ConductArea = {
      id: b.id,
      ...(b.name ? { name: b.name } : {}),
      kind: hours ? 'shop' : 'private',
      ...(hours ? { hours } : {}),
    };
    areas.set(b.id, area);
    for (let c = b.col; c < b.col + b.cols; c++) {
      for (let r = b.row; r < b.row + b.rows; r++) byCell.set(key(c, r), area);
    }
  }
  return {
    areaAt(x, z) {
      const c = Math.floor((x - x0) / cell);
      const r = Math.floor((z - z0) / cell);
      return byCell.get(key(c, r));
    },
  };
}
