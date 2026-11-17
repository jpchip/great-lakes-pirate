import lightStationsJson from '../../data/light_stations.json';
import {
  lightStationsFileSchema,
  type LightStationDef,
  type LightStationRules,
} from '../../data/schemas/light_stations';
import type { LighthouseDef } from '../../data/schemas/lighthouses';
import { Rng } from '../core/rng';
import { SECONDS_PER_GAME_DAY } from '../core/time';
import { LIGHTHOUSES, stationOffsetWorld, type PlacedLight } from './lighthouses';
import type { LightStationState } from './world-state';

/**
 * Lighthouse stations on foot (plan 11 §10, §18.4 piece H; plan 06 §6.2): the seven
 * Apostles stations as places you land at and walk. Pure, no three.js: the renderer draws
 * the kit's extra buildings and the landing from the same numbers the ashore scene makes
 * solid, and the game, the chart's lights and the keepers at sea all read the same state.
 *
 * The kit's frame is the renderer's (`render/lighthouses/kit.ts`): the tower's foot at the
 * origin, the ground at y = 0, the sea toward -z and the shore along x.
 */

const FILE = lightStationsFileSchema.parse(lightStationsJson);
export const STATION_RULES: LightStationRules = FILE.rules;
export const LIGHT_STATIONS: readonly LightStationDef[] = FILE.stations;

export function stationFor(lightId: string): LightStationDef | undefined {
  return LIGHT_STATIONS.find((s) => s.light === lightId);
}

export function lightDef(lightId: string): LighthouseDef | undefined {
  return LIGHTHOUSES.find((l) => l.id === lightId);
}

// --- The kit -------------------------------------------------------------------------------

/** A solid of the station in the kit's frame: a box (w across x, d along z) or a cylinder. */
export interface KitSolid {
  part: 'tower' | 'house' | 'oil' | 'fog' | 'gallery' | 'lantern' | 'rail' | 'leg' | 'stairs';
  shape: 'box' | 'cyl';
  x: number;
  z: number;
  /** Box width (x) and depth (z), or the cylinder's radius in `w`. */
  w: number;
  d: number;
  y0: number;
  y1: number;
  /** Turned about y, radians, three.js sense (rails round a round gallery). */
  yaw?: number;
}

/** A door you work at with F, in the kit's frame: where you stand. */
export interface KitDoor {
  x: number;
  z: number;
  /** The floor you stand on there, above the station's ground. */
  y: number;
}

/** A small building the Phase 2 kit didn't have, drawn by the renderer from these numbers. */
export interface KitExtra {
  part: 'oil' | 'fog';
  x: number;
  z: number;
  w: number;
  d: number;
  h: number;
  /** The fog signal's kind, for its look: a bell frame or a whistle house. */
  signal?: 'bell' | 'whistle' | 'horn' | 'siren';
}

export interface StationKit {
  solids: KitSolid[];
  extras: KitExtra[];
  doors: { tower: KitDoor; house: KitDoor; oil: KitDoor };
  /** The gallery round the lantern: its floor, where you step out, and the lamp. */
  gallery: { y: number; stand: KitDoor; lampX: number; lampZ: number; reachM: number };
  /** Climbing a skeleton tower is a ladder; the others have a stair inside. */
  ladder: boolean;
}

/** The skeleton tower's platform half-width: room to walk round the lantern. */
export function skeletonPlatformHalf(H: number): number {
  return Math.max(Math.max(0.9, H * 0.05) + 0.7, 2.1);
}

const RAIL_H = 1.05;

/** Rails round a round gallery: short tangent boards, so nobody walks off the edge. */
function roundRails(r: number, y: number, cx = 0, cz = 0): KitSolid[] {
  const n = 12;
  const out: KitSolid[] = [];
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2;
    out.push({
      part: 'rail',
      shape: 'box',
      x: cx + Math.sin(a) * (r + 0.05),
      z: cz + Math.cos(a) * (r + 0.05),
      w: ((2 * Math.PI * r) / n) * 1.05,
      d: 0.12,
      y0: y,
      y1: y + RAIL_H,
      yaw: a,
    });
  }
  return out;
}

/** Rails round a square gallery of half-width `h`. */
function squareRails(h: number, y: number, cx = 0, cz = 0): KitSolid[] {
  const side = (x: number, z: number, w: number, d: number): KitSolid => ({
    part: 'rail',
    shape: 'box',
    x: cx + x,
    z: cz + z,
    w,
    d,
    y0: y,
    y1: y + RAIL_H,
  });
  return [
    side(0, -h, h * 2, 0.12),
    side(0, h, h * 2, 0.12),
    side(-h, 0, 0.12, h * 2),
    side(h, 0, 0.12, h * 2),
  ];
}

/** The fog signal building, where the light has one. */
function fogExtra(def: LighthouseDef, x: number, z: number): KitExtra[] {
  const kind = def.fogSignal?.kind;
  if (!kind) return [];
  return kind === 'bell'
    ? [{ part: 'fog', x, z, w: 2.6, d: 2.6, h: 3.6, signal: 'bell' }]
    : [{ part: 'fog', x, z, w: 5, d: 3.6, h: 3.2, signal: kind }];
}

const box = (
  part: KitSolid['part'],
  x: number,
  z: number,
  w: number,
  d: number,
  y0: number,
  y1: number,
): KitSolid => ({ part, shape: 'box', x, z, w, d, y0, y1 });
const cyl = (part: KitSolid['part'], x: number, z: number, r: number, y0: number, y1: number) =>
  ({ part, shape: 'cyl', x, z, w: r, d: r, y0, y1 }) as KitSolid;

const extraSolid = (e: KitExtra): KitSolid =>
  box(e.part, e.x, e.z, e.w, e.d, -1, e.h + Math.min(e.w, e.d) * 0.4);

/** The station's solids, doors and gallery, in the kit's frame, from its tower style. */
export function stationKit(def: LighthouseDef): StationKit {
  const H = def.tower.heightM;
  if (def.tower.style === 'conical') {
    const rB = Math.max(2.4, H * 0.13);
    const rT = rB * 0.62;
    const galleryR = 1.3 + 0.9;
    const tower: KitSolid[] = [
      cyl('tower', 0, 0, rB, -1, H * 0.5),
      cyl('tower', 0, 0, (rB + rT) / 2, H * 0.5, H - 1),
      cyl('gallery', 0, 0, galleryR, H - 0.35, H),
      cyl('lantern', 0, 0, 1.3, H, H + 3.2),
      ...roundRails(galleryR, H),
    ];
    const gallery = { y: H, stand: { x: 0, z: 1.75, y: H }, lampX: 0, lampZ: 0, reachM: 2.8 };
    if (def.tower.finish === 'iron') {
      // La Pointe on its spit: the house close behind the tower, the rest along the shore.
      const extras: KitExtra[] = [
        { part: 'oil', x: 5.6, z: 3.2, w: 2.2, d: 2.2, h: 2.3 },
        ...fogExtra(def, -5.4, 3.2),
      ];
      return {
        solids: [...tower, box('house', 0, 3.5, 5.5, 3.2, -1, 6.8), ...extras.map(extraSolid)],
        extras,
        doors: {
          tower: { x: -(rB + 0.7), z: -0.5, y: 0 },
          house: { x: 3.5, z: 4.2, y: 0 },
          oil: { x: 5.6, z: 1.6, y: 0 },
        },
        gallery,
        ladder: false,
      };
    }
    const extras: KitExtra[] = fogExtra(def, -10, 4);
    return {
      solids: [
        ...tower,
        box('house', -2, 11, 9, 6.4, -1, 7.4),
        box('oil', 8.5, 6, 3.2, 3.2, -1, 4.4),
        ...extras.map(extraSolid),
      ],
      extras,
      doors: {
        tower: { x: 0, z: rB + 0.7, y: 0 },
        house: { x: 1.4, z: 7.2, y: 0 },
        oil: { x: 8.5, z: 3.8, y: 0 },
      },
      gallery,
      ladder: false,
    };
  }
  if (def.tower.style === 'dwelling') {
    const half = Math.max(1.7, H * 0.13);
    const gh = half + 0.55;
    const extras: KitExtra[] = [
      { part: 'oil', x: 7.6, z: 3.5, w: 2.4, d: 2.4, h: 2.4 },
      ...fogExtra(def, -7.8, 0.5),
    ];
    return {
      solids: [
        box('house', 0, 0, 10.4, 8.4, -1, 0.4),
        box('house', 0, 1.2, 9.2, 7, 0.4, 9.8),
        box('tower', 0, -3.2, half * 2, half * 2, 0.4, H - 0.35),
        box('gallery', 0, -3.2, gh * 2, gh * 2, H - 0.35, H),
        cyl('lantern', 0, -3.2, 1.3, H, H + 3.2),
        ...squareRails(gh, H, 0, -3.2),
        ...extras.map(extraSolid),
      ],
      extras,
      doors: {
        tower: { x: -2, z: 5.1, y: 0.4 },
        house: { x: 2, z: 5.1, y: 0.4 },
        oil: { x: 7.6, z: 1.8, y: 0 },
      },
      gallery: { y: H, stand: { x: 0, z: -3.2 + 1.75, y: H }, lampX: 0, lampZ: -3.2, reachM: 2.8 },
      ladder: false,
    };
  }
  // Skeleton: four legs, a platform with the lantern, the watch house at the foot.
  const foot = Math.max(2.2, H * 0.17);
  const ph = skeletonPlatformHalf(H);
  const extras: KitExtra[] = [
    // Behind the watch house along the axis: Chequamegon Point's spit is only a few meters wide.
    { part: 'oil', x: 0, z: 12.6, w: 2.2, d: 2.2, h: 2.3 },
    ...fogExtra(def, -6.5, 7),
  ];
  return {
    solids: [
      ...[
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ].map(([sx, sz]) => cyl('leg', (sx ?? 0) * foot, (sz ?? 0) * foot, 0.6, -1, 2.5)),
      box('gallery', 0, 0, ph * 2, ph * 2, H - 0.4, H),
      cyl('lantern', 0, 0, 1.05, H, H + 3),
      ...squareRails(ph, H),
      box('house', 0, 7, 4.2, 3.6, -1, 4.2),
      ...extras.map(extraSolid),
    ],
    extras,
    doors: {
      tower: { x: 0, z: 0.9, y: 0 },
      house: { x: 1, z: 4.6, y: 0 },
      oil: { x: 1.8, z: 10.6, y: 0 },
    },
    gallery: { y: H, stand: { x: 0, z: 1.6, y: H }, lampX: 0, lampZ: 0, reachM: 2.6 },
    ladder: true,
  };
}

// --- Placed in the zone --------------------------------------------------------------------

export interface PlacedPoint {
  x: number;
  y: number;
  z: number;
}

/** A solid in zone meters: `bearing` as `bearingBox` takes it (radians clockwise). */
export interface PlacedSolid {
  part: KitSolid['part'];
  shape: 'box' | 'cyl';
  x: number;
  z: number;
  w: number;
  d: number;
  bearing: number;
  minY: number;
  maxY: number;
}

export interface PlacedStation {
  light: PlacedLight;
  def: LightStationDef;
  /** The island it stands on. */
  island: string;
  solids: PlacedSolid[];
  doors: { tower: PlacedPoint; house: PlacedPoint; oil: PlacedPoint };
  gallery: { stand: PlacedPoint; lamp: PlacedPoint; reachM: number };
  /** The landing stage: a plank deck from the beach out over the water. */
  landing: PlacedSolid | undefined;
  /** A ladder down the landing stage's outer end to a boat alongside. */
  landingLadder:
    | {
        x: number;
        z: number;
        facing: number;
        bottomY: number;
        topY: number;
        topX: number;
        topZ: number;
      }
    | undefined;
  /**
   * Where the station stands on a bluff over its landing (Michigan Island's is 17 m up), the
   * stair up it: its foot on the landing and its head by the station, walked with F, and its
   * treads to draw (they aren't walked: the bluff is too steep for the ground under them).
   */
  bluff: { foot: PlacedPoint; head: PlacedPoint } | undefined;
  stairs: PlacedSolid[];
  ladder: boolean;
}

/** The landing stage's deck: its width, length and height over the lake. */
export const LANDING = { widthM: 2.4, lengthM: 12, deckM: 0.7, inlandM: 3 };

/**
 * Where the landing stage goes: from the tower out along its seaward bearing to the water's
 * edge, then out over the lake. Undefined if no water is found within 160 m (it never is).
 */
export function stationLanding(
  p: Pick<PlacedLight, 'x' | 'z' | 'seaward'>,
  heightAt: (x: number, z: number) => number,
): PlacedSolid | undefined {
  const fx = Math.sin(p.seaward);
  const fz = -Math.cos(p.seaward);
  for (let d = 4; d < 160; d += 1) {
    if (heightAt(p.x + fx * d, p.z + fz * d) > 0.2) continue;
    const mid = d - LANDING.inlandM + LANDING.lengthM / 2;
    return {
      part: 'house',
      shape: 'box',
      x: p.x + fx * mid,
      z: p.z + fz * mid,
      w: LANDING.widthM,
      d: LANDING.lengthM,
      bearing: p.seaward,
      minY: -1.5,
      maxY: LANDING.deckM,
    };
  }
  return undefined;
}

/** A tread every this much rise. */
const TREAD_RISE_M = 0.3;
/** A station this far over its landing has a stair up the bluff. */
export const BLUFF_RISE_M = 2.5;

/**
 * The stair from the landing's inner end up to the station's ground, straight along the
 * seaward axis, stopping short of the tower, where the station stands high over its landing.
 */
export function stationBluff(
  light: Pick<PlacedLight, 'x' | 'z' | 'seaward' | 'groundM'>,
  landing: PlacedSolid,
  heightAt: (x: number, z: number) => number,
  stopM: number,
): { foot: PlacedPoint; head: PlacedPoint; treads: PlacedSolid[] } | undefined {
  const fx = Math.sin(light.seaward);
  const fz = -Math.cos(light.seaward);
  const along = Math.hypot(landing.x - light.x, landing.z - light.z) - landing.d / 2 + 1;
  const hx = light.x + fx * stopM;
  const hz = light.z + fz * stopM;
  const footX = light.x + fx * (along - 0.5);
  const footZ = light.z + fz * (along - 0.5);
  // The deck's inner end can sit below a steep bank: the stair starts where you stand.
  const y0 = Math.max(landing.maxY, heightAt(footX, footZ));
  const y1 = Math.max(heightAt(hx, hz), light.groundM);
  const rise = y1 - y0;
  const run = along - stopM;
  if (rise < BLUFF_RISE_M || run < 2) return undefined;
  const n = Math.ceil(rise / TREAD_RISE_M);
  const depth = run / n;
  const treads: PlacedSolid[] = [];
  for (let k = 1; k <= n; k++) {
    const d = along - depth * (k - 0.5);
    const x = light.x + fx * d;
    const z = light.z + fz * d;
    const top = y0 + (rise * k) / n;
    if (heightAt(x, z) > top + 0.1) continue;
    treads.push({
      part: 'stairs',
      shape: 'box',
      x,
      z,
      w: 1.4,
      d: depth + 0.02,
      bearing: light.seaward,
      minY: top - 0.3,
      maxY: top,
    });
  }
  return {
    foot: { x: footX, y: y0, z: footZ },
    head: { x: hx, y: y1, z: hz },
    treads,
  };
}

/** A station set down where its light stands. */
export function placeStation(
  light: PlacedLight,
  heightAt: (x: number, z: number) => number,
): PlacedStation | undefined {
  const def = stationFor(light.def.id);
  if (!def) return undefined;
  const kit = stationKit(light.def);
  const g = light.groundM;
  const at = (x: number, z: number, y: number): PlacedPoint => {
    const w = stationOffsetWorld(light.seaward, x, z);
    return { x: light.x + w.x, y: g + y, z: light.z + w.z };
  };
  // A door stands on whatever ground is there: a station on a slope has its doors uphill.
  const door = (x: number, z: number, y: number): PlacedPoint => {
    const p = at(x, z, y);
    return { ...p, y: Math.max(p.y, heightAt(p.x, p.z)) };
  };
  const landing = stationLanding(light, heightAt);
  const fx = Math.sin(light.seaward);
  const fz = -Math.cos(light.seaward);
  const end = landing && {
    x: landing.x + fx * (landing.d / 2 + 0.02),
    z: landing.z + fz * (landing.d / 2 + 0.02),
  };
  const bluff = landing && stationBluff(light, landing, heightAt, stairStop(light.def));
  const solids = kit.solids.map((s): PlacedSolid => {
    const c = at(s.x, s.z, 0);
    return {
      part: s.part,
      shape: s.shape,
      x: c.x,
      z: c.z,
      w: s.w,
      d: s.d,
      // Kit yaw is three.js (counter-clockwise); a bearing is clockwise.
      bearing: light.seaward - (s.yaw ?? 0),
      minY: g + s.y0,
      maxY: g + s.y1,
    };
  });
  return {
    light,
    def,
    island: def.island,
    solids,
    doors: {
      tower: door(kit.doors.tower.x, kit.doors.tower.z, kit.doors.tower.y),
      house: door(kit.doors.house.x, kit.doors.house.z, kit.doors.house.y),
      oil: door(kit.doors.oil.x, kit.doors.oil.z, kit.doors.oil.y),
    },
    gallery: {
      stand: at(kit.gallery.stand.x, kit.gallery.stand.z, kit.gallery.stand.y),
      lamp: at(kit.gallery.lampX, kit.gallery.lampZ, kit.gallery.y),
      reachM: kit.gallery.reachM,
    },
    landing,
    landingLadder:
      landing && end
        ? {
            x: end.x,
            z: end.z,
            facing: light.seaward + Math.PI,
            bottomY: -1.2,
            topY: landing.maxY,
            topX: end.x - fx * 0.7,
            topZ: end.z - fz * 0.7,
          }
        : undefined,
    bluff: bluff && { foot: bluff.foot, head: bluff.head },
    stairs: bluff?.treads ?? [],
    ladder: kit.ladder,
  };
}

/** Where the stairs stop short of the tower: past its foot and its gallery's shadow. */
function stairStop(def: LighthouseDef): number {
  if (def.tower.style === 'conical') return Math.max(2.4, def.tower.heightM * 0.13) + 2.5;
  if (def.tower.style === 'dwelling') return 4.2 + 3.2;
  return Math.max(2.2, def.tower.heightM * 0.17) + 1.5;
}

// --- The station's state -------------------------------------------------------------------

/** A keeper's id: the light and his place on the roster, `light.raspberry.k1`. */
export function keeperId(lightId: string, k: number): string {
  return `${lightId}.k${k + 1}`;
}

/** The keepers who live at a station now, by id and name (head keeper first). */
export function stationKeepers(
  light: Pick<LighthouseDef, 'id' | 'keepers'>,
): { id: string; name: string }[] {
  const def = stationFor(light.id);
  const n = Math.min(light.keepers, def?.keepers.length ?? light.keepers);
  return Array.from({ length: n }, (_, k) => ({
    id: keeperId(light.id, k),
    name: def?.keepers[k] ?? `Keeper ${k + 1}`,
  }));
}

export function emptyStation(): LightStationState {
  return { keepers: {} };
}

const DAY = SECONDS_PER_GAME_DAY;

/** A keeper who is at his post: not dead, not tied up or out cold, not paid to look away. */
export function onDuty(
  st: LightStationState | undefined,
  id: string,
  t: number,
  rules: LightStationRules = STATION_RULES,
): boolean {
  const f = st?.keepers[id];
  if (!f) return true;
  if (f.diedAt !== undefined && t < f.diedAt + rules.replaceDays * DAY) return false;
  if (f.downUntil !== undefined && t < f.downUntil) return false;
  if (f.bribedUntil !== undefined && t < f.bribedUntil) return false;
  return true;
}

/** A keeper still living there (a dead man's place is empty until his relief comes). */
export function living(
  st: LightStationState | undefined,
  id: string,
  t: number,
  rules: LightStationRules = STATION_RULES,
): boolean {
  const d = st?.keepers[id]?.diedAt;
  return d === undefined || t >= d + rules.replaceDays * DAY;
}

/** How many of a light's keepers are at their posts now. */
export function keepersOnDuty(
  light: Pick<LighthouseDef, 'id' | 'keepers'>,
  st: LightStationState | undefined,
  t: number,
): number {
  return stationKeepers(light).filter((k) => onDuty(st, k.id, t)).length;
}

/**
 * Time passes at a station: a dead keeper's relief arrives (his record goes), a fate that's
 * run out is dropped, and a doused lamp is lit again by a keeper at his post once he's had
 * time to see it. True if anything changed.
 */
export function settleStation(
  light: Pick<LighthouseDef, 'id' | 'keepers'>,
  st: LightStationState,
  t: number,
  rules: LightStationRules = STATION_RULES,
): boolean {
  let changed = false;
  for (const [id, f] of Object.entries(st.keepers)) {
    const gone =
      (f.diedAt === undefined || t >= f.diedAt + rules.replaceDays * DAY) &&
      (f.downUntil === undefined || t >= f.downUntil) &&
      (f.bribedUntil === undefined || t >= f.bribedUntil);
    if (gone) {
      Reflect.deleteProperty(st.keepers, id);
      changed = true;
    }
  }
  if (
    st.dousedAt !== undefined &&
    t >= st.dousedAt + rules.relightMin * 60 &&
    keepersOnDuty(light, st, t) > 0
  ) {
    delete st.dousedAt;
    changed = true;
  }
  return changed;
}

/** The lamp is out: doused and not yet lit again. */
export function lampOut(st: LightStationState | undefined): boolean {
  return st?.dousedAt !== undefined;
}

/** Cans of kerosene left in the oil house. */
export function oilLeft(
  def: LightStationDef,
  st: LightStationState | undefined,
  t: number,
  rules: LightStationRules = STATION_RULES,
): number {
  const o = st?.oilTaken;
  if (!o || t - o.since >= rules.restockDays * DAY) return def.kerosene;
  return Math.max(0, def.kerosene - o.count);
}

/** The house has something in it worth taking (robbed, it fills again after the restock). */
export function houseStocked(
  st: LightStationState | undefined,
  t: number,
  rules: LightStationRules = STATION_RULES,
): boolean {
  const r = st?.houseRobbedAt;
  return r === undefined || t - r >= rules.restockDays * DAY;
}

/** What the house gives up, cents: from the run's seed and the stocking it's in. */
export function houseCash(
  def: LightStationDef,
  runSeed: number,
  t: number,
  rules: LightStationRules = STATION_RULES,
): number {
  const period = Math.floor(t / (rules.restockDays * DAY));
  const rng = Rng.fromSeed(`${runSeed}:${def.light}:house:${period}`);
  const [lo, hi] = def.houseCashCents;
  return Math.round(lo + (hi - lo) * rng.next());
}

/** Keepers welcome a visitor by day at this Wanted tier (plan 11 §10). */
export function welcomeAt(tier: number, rules: LightStationRules = STATION_RULES): boolean {
  return tier <= rules.welcomeMaxTier;
}

/** The logbook's still in the house: taken, it's gone until the next stocking. */
export function logbookHere(
  st: LightStationState | undefined,
  t: number,
  rules: LightStationRules = STATION_RULES,
): boolean {
  const at = st?.logbookTakenAt;
  return at === undefined || t - at >= rules.restockDays * DAY;
}
