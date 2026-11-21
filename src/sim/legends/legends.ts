import cachesJson from '../../../data/caches.json';
import cluesJson from '../../../data/clues.json';
import legendsJson from '../../../data/legends.json';
import {
  cachesFileSchema,
  cluesFileSchema,
  legendsFileSchema,
  type ClueDef,
  type LegendDef,
  type SeededCacheDef,
} from '../../../data/schemas/legends';
import { ChartProjection, chartToZone, type Geo, type ZoneFrame } from '../../core/coords';
import { Rng } from '../../core/rng';
import type { PlacedCave } from '../caves/caves';
import {
  placePoi,
  poiDef,
  type PlacedIsland,
  type PlacedPoiMark,
  type PlacedPoiPiece,
} from '../islands/on-foot';

/**
 * Clues, legends and seeded caches (plan 11 §7–9; §18.4 piece T). Pure: the game asks it
 * which clues a source holds, where a legend's payoff lies in the loaded zone, and what a
 * run's seed has hidden where.
 *
 * - **Clues** come from a light station's logbook, the papers in a district's desks and
 *   strongboxes, wreck papers (piece U's), marks in the land read with F, and the tale
 *   itself. Each one shrinks its lead's circle (piece O's `addClue`).
 * - **Maps**: three clues on a lead and a cartography table make it a map, its circle
 *   drawn tight round the spot with an X.
 * - **The spot**: dug for with F held, searched for in a cave at the dark of the moon,
 *   grappled up from a wreck, or dug for above a beaten copycat's camp.
 * - **Seeded caches**: candidate hiding places at the islands' cairns and cabins; each run
 *   stocks some, and a note in a district's papers can put you onto one.
 */

export const LEGEND_FILE = legendsFileSchema.parse(legendsJson);
export const LEGEND_RULES = LEGEND_FILE.rules;
export const LEGENDS: readonly LegendDef[] = LEGEND_FILE.legends;
export const CLUES: readonly ClueDef[] = cluesFileSchema.parse(cluesJson);
export const CACHE_FILE = cachesFileSchema.parse(cachesJson);
export const SEEDED_CACHES: readonly SeededCacheDef[] = CACHE_FILE.caches;

export const HOARD_LEGEND = 'legend.copycat_hoard';

export function legendDef(id: string): LegendDef | undefined {
  return LEGENDS.find((l) => l.id === id);
}

export function clueDef(id: string): ClueDef | undefined {
  return CLUES.find((c) => c.id === id);
}

export function seededCache(id: string): SeededCacheDef | undefined {
  return SEEDED_CACHES.find((c) => c.id === id);
}

/** The clues a light station's log holds. */
export function logbookClues(light: string): ClueDef[] {
  return CLUES.filter((c) => c.source.kind === 'logbook' && c.source.light === light);
}

/** The next clue among a district's papers not yet found, in the file's order. */
export function documentClue(district: string, found: readonly string[]): ClueDef | undefined {
  return CLUES.find(
    (c) => c.source.kind === 'document' && c.source.district === district && !found.includes(c.id),
  );
}

/** The cash in a legend's payoff, by the run's seed. */
export function legendCash(def: LegendDef, runSeed: number): number {
  const [lo, hi] = def.cashCents;
  const rng = Rng.fromSeed(`${runSeed}:${def.id}`);
  return Math.round((lo + (hi - lo) * rng.next()) / 100) * 100;
}

// --- Seeded caches.

/** The seeded caches stocked this run (plan 11 §9: the seed decides which). */
export function stockedCaches(runSeed: number): Set<string> {
  const rng = Rng.fromSeed(`${runSeed}:caches`);
  const ids = SEEDED_CACHES.map((c) => c.id);
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    [ids[i], ids[j]] = [ids[j] as string, ids[i] as string];
  }
  const n = Math.max(1, Math.round(ids.length * CACHE_FILE.stockedShare));
  return new Set(ids.slice(0, n));
}

/**
 * The note in a district's papers, if this box's are one (by the seed and the box): a
 * stocked cache you haven't a note for yet.
 */
export function cacheNote(
  runSeed: number,
  box: string,
  notes: readonly string[],
): SeededCacheDef | undefined {
  const rng = Rng.fromSeed(`${runSeed}:note:${box}`);
  if (!rng.chance(CACHE_FILE.noteChance)) return undefined;
  const stocked = stockedCaches(runSeed);
  const open = SEEDED_CACHES.filter((c) => stocked.has(c.id) && !notes.includes(c.id));
  return open.length ? rng.pick(open) : undefined;
}

// --- Maps.

/** Why a lead can't be made a map now, or undefined. */
export function mapRefusal(
  lead: { id: string; clues: readonly unknown[]; closed?: unknown },
  maps: Readonly<Record<string, number>>,
): string | undefined {
  if (lead.closed) return 'Run down already.';
  if (maps[lead.id] !== undefined) return 'Mapped already.';
  const need = LEGEND_RULES.mapClues;
  if (lead.clues.length < need) {
    return `${lead.clues.length} of ${need} clues: not enough to put an X on it.`;
  }
  return undefined;
}

/** Where a legend's spot lies on the chart, when it's fixed (not a copycat's). */
export function legendSpotGeo(def: LegendDef, wreckAt?: (id: string) => Geo | undefined) {
  const s = def.spot;
  if (s.kind === 'poi' || s.kind === 'chart' || s.kind === 'cave') return s.at;
  if (s.kind === 'wreck') return wreckAt?.(s.wreck);
  return undefined;
}

// --- In the loaded zone.

/** A legend's spot (or a seeded hoard's) set down in the loaded zone. */
export interface PlacedLegendSpot {
  /** The lead it pays off: a legend id, or a copycat's stash lead. */
  lead: string;
  legend: string;
  name: string;
  kind: 'dig' | 'search' | 'cave';
  x: number;
  y: number;
  z: number;
  /** The cave whose ice or ledge it's on. */
  cave?: string;
}

/** A clue to read with F where it lies. */
export interface PlacedClueMark {
  clue: string;
  name: string;
  x: number;
  y: number;
  z: number;
}

/** A pad on the mainland walked round a legend's spot (Minnesota Point). */
export interface LegendPad {
  id: string;
  name: string;
  x: number;
  z: number;
}

/** A copycat's camp on an island: a hoard is dug in on the land nearest it. */
export interface HoardCamp {
  /** The camp's id (`camp.cat`): the spot's `lead` until a beaten rival's is known. */
  id: string;
  island: string;
  at: Geo;
}

export interface PlacedLegends {
  spots: PlacedLegendSpot[];
  marks: PlacedClueMark[];
  pads: LegendPad[];
}

const GEO = new ChartProjection();

const markOf = (
  islands: readonly PlacedIsland[],
  island: string,
  poi: string,
  mark: string,
): { island: PlacedIsland; mark: PlacedPoiMark } | undefined => {
  const i = islands.find((k) => k.id === island);
  const m = i?.marks.find((k) => k.poi === poi && k.id === mark);
  return i && m ? { island: i, mark: m } : undefined;
};

/** Dug ground and a blazed stake (piece P's dig spot), set down at a point. */
function digPieces(
  id: string,
  x: number,
  z: number,
  facingDeg: number,
  heightAt: (x: number, z: number) => number,
): PlacedPoiPiece[] {
  const def = poiDef('poi.dig_spot');
  if (!def) return [];
  return placePoi(def, { id, x, z, facingDeg }, { x0: 0, z0: 0 }, heightAt).pieces;
}

/**
 * The land nearest a point (a copycat's anchorage, a dead tower on a spit): the closest
 * point in rings round it that stands `minY` over the lake on ground no steeper than a
 * walk. Undefined when there's none within `maxM`.
 */
export function landNear(
  x: number,
  z: number,
  heightAt: (x: number, z: number) => number,
  minY = 1,
  maxM = 400,
): { x: number; z: number } | undefined {
  for (let r = 0; r <= maxM; r += 4) {
    const n = r === 0 ? 1 : Math.max(8, Math.round((2 * Math.PI * r) / 4));
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      const px = x + Math.sin(a) * r;
      const pz = z - Math.cos(a) * r;
      const y = heightAt(px, pz);
      if (y < minY) continue;
      const slope =
        Math.max(
          Math.abs(heightAt(px + 1.5, pz) - heightAt(px - 1.5, pz)),
          Math.abs(heightAt(px, pz + 1.5) - heightAt(px, pz - 1.5)),
        ) / 3;
      if (slope < 0.45) return { x: px, z: pz };
    }
  }
  return undefined;
}

/**
 * The legends' spots and clue marks in a zone: on its islands' prefab marks (dug ground
 * drawn where they're dug), in its caves, on a pad on the mainland, and above every
 * copycat camp (a hoard is there once a rival camping there is beaten). The dug ground and the pads' pieces are added to the
 * islands placed (a pad is an island of its own, for the view and the colliders).
 */
export function placeLegends(
  zoneId: string,
  islands: PlacedIsland[],
  caves: readonly PlacedCave[],
  frame: ZoneFrame | undefined,
  heightAt: (x: number, z: number) => number,
  camps: readonly HoardCamp[] = [],
): PlacedLegends {
  const spots: PlacedLegendSpot[] = [];
  const marks: PlacedClueMark[] = [];
  const pads: LegendPad[] = [];
  const toZone = (at: Geo) => (frame ? chartToZone(GEO.geoToChart(at), frame) : undefined);

  for (const def of LEGENDS) {
    const s = def.spot;
    if (s.kind === 'poi') {
      const hit = markOf(islands, s.island, s.poi, s.mark);
      if (!hit) continue;
      const { mark } = hit;
      spots.push({
        lead: def.id,
        legend: def.id,
        name: s.name,
        kind: s.dig ? 'dig' : 'search',
        x: mark.x,
        y: mark.y,
        z: mark.z,
      });
      if (s.dig) {
        hit.island.pieces.push(
          ...digPieces(def.id, mark.x, mark.z, (mark.facing * 180) / Math.PI, heightAt),
        );
        hit.island.clearings.push(digClearing(mark.x, mark.z));
      }
    } else if (s.kind === 'cave') {
      const cave = caves.find((c) => c.id === s.cave);
      const m = cave?.marks.find((k) => k.id === s.mark);
      if (!cave || !m) continue;
      spots.push({
        lead: def.id,
        legend: def.id,
        name: s.name,
        kind: 'cave',
        x: m.x,
        y: m.y,
        z: m.z,
        cave: cave.id,
      });
    } else if (s.kind === 'chart') {
      if (s.zone !== zoneId) continue;
      const at = toZone(s.at);
      if (!at) continue;
      const land = landNear(at.x, at.z, heightAt, 0.5, 60) ?? at;
      const y = heightAt(land.x, land.z);
      spots.push({ lead: def.id, legend: def.id, name: s.name, kind: 'dig', ...land, y });
      const pieces = digPieces(def.id, land.x, land.z, 0, heightAt);
      // A clue at the pad: by the spot, a few steps off.
      for (const c of CLUES) {
        if (c.source.kind !== 'pad' || c.source.legend !== def.id) continue;
        const mx = land.x + 3;
        marks.push({ clue: c.id, name: c.source.name, x: mx, y: heightAt(mx, land.z), z: land.z });
      }
      pads.push({ id: def.id, name: s.place, x: land.x, z: land.z });
      islands.push(padIsland(def.id, s.place, pieces, land.x, land.z));
    }
  }

  // The clue marks on the islands and in the caves.
  for (const c of CLUES) {
    const src = c.source;
    if (src.kind === 'mark') {
      const hit = markOf(islands, src.island, src.poi, src.mark);
      if (hit)
        marks.push({ clue: c.id, name: src.name, x: hit.mark.x, y: hit.mark.y, z: hit.mark.z });
    } else if (src.kind === 'caveMark') {
      const m = caves.find((k) => k.id === src.cave)?.marks.find((k) => k.id === src.mark);
      if (m) marks.push({ clue: c.id, name: src.name, x: m.x, y: m.y, z: m.z });
    }
  }

  // The copycats' hoards: on the land nearest their camps.
  const hoard = legendDef(HOARD_LEGEND);
  for (const camp of camps) {
    const island = islands.find((i) => i.id === camp.island);
    const at = toZone(camp.at);
    if (!island || !at || !hoard) continue;
    const land = landNear(at.x, at.z, heightAt);
    if (!land) continue;
    const y = heightAt(land.x, land.z);
    spots.push({
      lead: camp.id,
      legend: HOARD_LEGEND,
      name: hoard.spot.kind === 'stash' ? hoard.spot.name : 'the hoard',
      kind: 'dig',
      ...land,
      y,
    });
    island.pieces.push(...digPieces(camp.id, land.x, land.z, 0, heightAt));
    island.clearings.push(digClearing(land.x, land.z));
  }
  return { spots, marks, pads };
}

/** Kept clear of trees round a dig, so the turned ground shows. */
function digClearing(x: number, z: number) {
  return { x, z, ux: 1, uz: 0, halfAlong: 3, halfAcross: 3 };
}

/** A pad's own island: its pieces drawn and solid, nothing else on it. */
function padIsland(
  id: string,
  name: string,
  pieces: PlacedPoiPiece[],
  x: number,
  z: number,
): PlacedIsland {
  return {
    id,
    name,
    mainland: true,
    pieces,
    ladders: [],
    caches: [],
    clearings: [{ x, z, ux: 1, uz: 0, halfAlong: 6, halfAcross: 6 }],
    marks: [],
    landings: [],
    residents: [],
    reporting: 'slow',
  };
}

/** The Devil's Grotto's ledge shows: a moon this dark, after sunset (or on the ice). */
export function darkOfTheMoon(moonIllumination: number, sunElevationRad: number): boolean {
  return sunElevationRad < 0 && moonIllumination <= LEGEND_RULES.darkMoon;
}
