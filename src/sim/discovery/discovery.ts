import { z } from 'zod';
import curiosJson from '../../../data/curios.json';
import discoveriesJson from '../../../data/discoveries.json';
import {
  curiosFileSchema,
  discoveriesFileSchema,
  type CurioDef,
  type DiscoveriesFile,
  type DiscoveryDef,
  type DiscoveryKind,
} from '../../../data/schemas/discoveries';
import { geoSchema } from '../../../data/schemas/zones';
import { ChartProjection, type Chart, type Geo } from '../../core/coords';

/**
 * Discovery, leads and curios (plan 11 §7, §11, §14; plan 03 §5.2; Phase 9 piece O). Pure:
 * the game feeds it where the captain is looking from and what's been heard, bought or
 * read, and it says what's newly on the chart.
 *
 * The fog of war is over the places on the chart, not its coast: the Lake Survey printed
 * western Superior's shore and soundings, so those are always drawn. Points of interest,
 * natural wonders, hideout sites and wrecks go on the chart when a lookout sees them (by
 * day, in clear weather, nearer at night or in fog, further through the spyglass) or you
 * walk up to them; coves and shoals when you sail into them, buy the survey sheet that has
 * them, or read a lighthouse log that notes them. Saloon talk puts a place on as reported
 * until it's seen.
 */

/** How a place came onto the chart. */
export const FOUND_HOWS = [
  /** A lookout saw it. */
  'sight',
  /** Seen through the spyglass. */
  'spyglass',
  /** Walked up to it ashore. */
  'foot',
  /** Sailed into the cove or over the shoal. */
  'visit',
  /** The lead line's spike over a wreck on the bottom (piece U). */
  'sounding',
  /** From a Lake Survey sheet. */
  'survey',
  /** Noted in a light station's log. */
  'logbook',
  /** A wreck of your own making, or a site you hold. */
  'yours',
  /** Known before discovery was kept (an older save), or from the start of the run. */
  'start',
] as const;
export type FoundHow = (typeof FOUND_HOWS)[number];

export const discoveryStateSchema = z.object({
  /** On the chart: places, sites and wrecks by id, when and how. */
  found: z.record(z.string(), z.object({ at: z.number(), how: z.enum(FOUND_HOWS) })),
  /** Talked of in a saloon, not yet seen: by id, when and the port. */
  heard: z.record(z.string(), z.object({ at: z.number(), port: z.string() })),
});
export type DiscoveryState = z.infer<typeof discoveryStateSchema>;

export const LEAD_KINDS = ['legend', 'place', 'cache', 'wreck', 'stash'] as const;
export type LeadKind = (typeof LEAD_KINDS)[number];

export const leadSchema = z.object({
  /** One lead a subject: `legend.lucerne`, a cache id, a wreck id. */
  id: z.string(),
  kind: z.enum(LEAD_KINDS),
  title: z.string(),
  /** "off Long Island". */
  where: z.string(),
  /** The search circle on the chart: its middle and how far out it reaches, real meters. */
  center: geoSchema,
  radiusM: z.number().positive(),
  /** What's been learned, oldest first. */
  clues: z.array(z.object({ at: z.number(), text: z.string(), from: z.string() })),
  openedAt: z.number(),
  /** Run down: found, or come to nothing. Absent while it's open. */
  closed: z.object({ at: z.number(), outcome: z.enum(['found', 'cold']) }).optional(),
});
export type Lead = z.infer<typeof leadSchema>;
export const leadsSchema = z.array(leadSchema);

export const curioStateSchema = z.object({
  id: z.string(),
  gotAt: z.number(),
  /** "the quarrymen's cache on Stockton Island". */
  from: z.string(),
  /** The hideout it's set out at; absent, it's aboard in your sea chest. */
  shownAt: z.string().optional(),
});
export type CurioState = z.infer<typeof curioStateSchema>;
export const curiosSchema = z.array(curioStateSchema);

// --- Definitions.

let cachedFile: DiscoveriesFile | undefined;
let cachedCurios: readonly CurioDef[] | undefined;

export function discoveriesFile(): DiscoveriesFile {
  cachedFile ??= discoveriesFileSchema.parse(discoveriesJson);
  return cachedFile;
}

export function curioDefs(): readonly CurioDef[] {
  cachedCurios ??= curiosFileSchema.parse(curiosJson);
  return cachedCurios;
}

export function curioDef(id: string): CurioDef | undefined {
  return curioDefs().find((c) => c.id === id);
}

export function placeDefs(): readonly DiscoveryDef[] {
  return discoveriesFile().places;
}

export function placeDef(id: string): DiscoveryDef | undefined {
  return placeDefs().find((p) => p.id === id);
}

/** The lake-wide projection the zones' frames use, so a zone's meters land on it. */
const WORLD = new ChartProjection();

export function worldChart(at: Geo): Chart {
  return WORLD.geoToChart(at);
}

export function worldGeo(at: Chart): Geo {
  return WORLD.chartToGeo(at);
}

/** Real meters between two geo points (the lake-wide projection is close enough here). */
export function geoDistanceM(a: Geo, b: Geo): number {
  const p = worldChart(a);
  const q = worldChart(b);
  return Math.hypot(p.x - q.x, p.y - q.y);
}

// --- State.

export function createDiscovery(): DiscoveryState {
  return { found: {}, heard: {} };
}

export function isFound(d: DiscoveryState | undefined, id: string): boolean {
  return !!d?.found[id];
}

export function isHeard(d: DiscoveryState | undefined, id: string): boolean {
  return !!d && !d.found[id] && !!d.heard[id];
}

/** Puts a place on the chart; true when it wasn't already. A report heard of it is spent. */
export function markFound(d: DiscoveryState, id: string, how: FoundHow, now: number): boolean {
  if (d.found[id]) return false;
  d.found[id] = { at: now, how };
  Reflect.deleteProperty(d.heard, id);
  return true;
}

/** Puts a place on the chart as reported; true when it's news. */
export function markHeard(d: DiscoveryState, id: string, port: string, now: number): boolean {
  if (d.found[id] || d.heard[id]) return false;
  d.heard[id] = { at: now, port };
  return true;
}

/** Something the lookout or the captain could find: a place, a site, a wreck. */
export interface DiscoveryTarget {
  id: string;
  kind: DiscoveryKind | 'site' | 'wreck';
  at: Geo;
  /** By-day sight range, real meters (sighted targets). */
  sightM?: number | undefined;
  /** Sail inside to chart it (coves and shoals). */
  radiusM?: number | undefined;
}

/** Hideout sites and wrecks are seen from about this far, real meters. */
export const SITE_SIGHT_M = 3500;
export const WRECK_SIGHT_M = 2500;

/** Every place in `discoveries.json` as a target. */
export function placeTargets(defs: readonly DiscoveryDef[] = placeDefs()): DiscoveryTarget[] {
  return defs.map((p) => ({
    id: p.id,
    kind: p.kind,
    at: p.at,
    sightM: p.sightM,
    radiusM: p.radiusM,
  }));
}

/** Where the captain is looking from, and how well they can see. */
export interface Lookout {
  at: Geo;
  /** 0 at night, 1 by day. */
  daylight: number;
  /** How far one can see through the weather, real meters (fog, rain). */
  visibilityM: number;
  /** The spyglass is up. */
  spyglass: boolean;
  /** On foot ashore: a lower eye, and nothing charted by "sailing into" it. */
  onFoot: boolean;
  /** The lookout's instruments: the spyglass's reach as a multiple (1 bare). */
  glassMul?: number;
}

/** A night lookout sees this share of the day's range (no moon in the reckoning yet). */
export const NIGHT_SIGHT = 0.3;
/** The spyglass reaches this many times further (an instrument upgrade adds to it). */
export const SPYGLASS_MUL = 2.5;
/** On foot, behind trees and below a deck's height. */
export const FOOT_SIGHT = 0.5;
/** Walking up to a point of interest charts it from this close, real meters. */
export const FOOT_REACH_M = 400;

/** How far a lookout notes a target with this by-day range. */
export function sightRangeM(sightM: number, look: Lookout): number {
  let r = sightM * (NIGHT_SIGHT + (1 - NIGHT_SIGHT) * Math.min(1, Math.max(0, look.daylight)));
  if (look.spyglass) r *= SPYGLASS_MUL * (look.glassMul ?? 1);
  if (look.onFoot) r = Math.max(r * FOOT_SIGHT, FOOT_REACH_M);
  // The weather limits even the glass; a little more than the naked eye, through haze.
  const cap = Math.max(200, look.visibilityM * (look.spyglass ? 1.25 : 1));
  return Math.min(r, cap);
}

/** One look round: what's newly found from here, with how. Marks them found. */
export function lookAround(
  d: DiscoveryState,
  targets: readonly DiscoveryTarget[],
  look: Lookout,
  now: number,
): { id: string; how: FoundHow }[] {
  const here = worldChart(look.at);
  const out: { id: string; how: FoundHow }[] = [];
  for (const t of targets) {
    if (d.found[t.id]) continue;
    const p = worldChart(t.at);
    const dist = Math.hypot(p.x - here.x, p.y - here.y);
    let how: FoundHow | undefined;
    if (t.radiusM !== undefined && (t.kind === 'anchorage' || t.kind === 'shoal')) {
      // Coves and shoals: sailed into (the lead goes down), not seen from afar.
      if (!look.onFoot && dist <= t.radiusM) how = 'visit';
    } else if (t.sightM !== undefined) {
      if (look.onFoot && dist <= FOOT_REACH_M) how = 'foot';
      else if (dist <= sightRangeM(t.sightM, look)) {
        // Seen through the glass only if the bare eye wouldn't have had it.
        const bare = sightRangeM(t.sightM, { ...look, spyglass: false });
        how = look.onFoot ? 'foot' : look.spyglass && dist > bare ? 'spyglass' : 'sight';
      }
    }
    if (how && markFound(d, t.id, how, now)) out.push({ id: t.id, how });
  }
  return out;
}

/** A Lake Survey sheet bought: its coves and shoals charted. Returns the new ones. */
export function chartSurvey(d: DiscoveryState, survey: string, now: number): string[] {
  return placeDefs()
    .filter((p) => p.survey === survey && markFound(d, p.id, 'survey', now))
    .map((p) => p.id);
}

/** A keeper's log notes the shoals and wrecks near the light (plan 11 §10). */
export const LOGBOOK_SHOAL_M = 9000;
export const LOGBOOK_WRECK_M = 12000;

/** A light station's logbook read: the shoals and wrecks it notes, charted. */
export function chartFromLogbook(
  d: DiscoveryState,
  light: Geo,
  wrecks: readonly { id: string; at: Geo }[],
  now: number,
): string[] {
  const out: string[] = [];
  for (const p of placeDefs()) {
    if (p.kind !== 'shoal' || geoDistanceM(p.at, light) > LOGBOOK_SHOAL_M) continue;
    if (markFound(d, p.id, 'logbook', now)) out.push(p.id);
  }
  for (const w of wrecks) {
    if (geoDistanceM(w.at, light) > LOGBOOK_WRECK_M) continue;
    if (markFound(d, w.id, 'logbook', now)) out.push(w.id);
  }
  return out;
}

/**
 * What an older save, or a new run, already knows (plan 11 §18.4 piece O: "an existing
 * save starts with what it has visited charted"): every target within `radiusM` of a
 * place the captain has been.
 */
export function chartAround(
  d: DiscoveryState,
  targets: readonly DiscoveryTarget[],
  visited: readonly Geo[],
  radiusM: number,
  now: number,
): string[] {
  const out: string[] = [];
  for (const t of targets) {
    if (d.found[t.id]) continue;
    if (visited.some((v) => geoDistanceM(v, t.at) <= radiusM + (t.radiusM ?? 0))) {
      if (markFound(d, t.id, 'start', now)) out.push(t.id);
    }
  }
  return out;
}

/** Over a charted shoal the depth readout warns this many drafts out (the sounding machine's). */
export const CHARTED_SHOAL_WARN_DRAFTS = 3;

/** Is this point inside a shoal on the chart? */
export function overChartedShoal(d: DiscoveryState, at: Geo): boolean {
  for (const p of placeDefs()) {
    if (p.kind !== 'shoal' || !p.radiusM || !d.found[p.id]) continue;
    if (geoDistanceM(p.at, at) <= p.radiusM) return true;
  }
  return false;
}

// --- Leads.

export interface LeadInput {
  id: string;
  kind: LeadKind;
  title: string;
  where: string;
  center: Geo;
  radiusM: number;
  clue: { text: string; from: string };
}

export function findLead(leads: readonly Lead[], id: string): Lead | undefined {
  return leads.find((l) => l.id === id);
}

/** Opens a lead with its first clue; the existing one when there's one already. */
export function openLead(leads: Lead[], input: LeadInput, now: number): Lead {
  const have = findLead(leads, input.id);
  if (have) return have;
  const lead: Lead = {
    id: input.id,
    kind: input.kind,
    title: input.title,
    where: input.where,
    center: { lat: input.center.lat, lon: input.center.lon },
    radiusM: input.radiusM,
    clues: [{ at: now, text: input.clue.text, from: input.clue.from }],
    openedAt: now,
  };
  leads.push(lead);
  return lead;
}

/**
 * Another clue (plan 11 §7.3): the circle shrinks to `shrink` of what it was, no smaller
 * than `minRadiusM`, and its middle moves toward `toward` (where the clue points) so the
 * true spot stays inside it. The same clue twice changes nothing.
 */
export function addClue(
  lead: Lead,
  clue: { text: string; from: string; toward?: Geo | undefined },
  now: number,
  rules: { shrink: number; minRadiusM: number } = {
    shrink: discoveriesFile().leadShrink,
    minRadiusM: discoveriesFile().leadMinRadiusM,
  },
): boolean {
  if (lead.closed || lead.clues.some((c) => c.text === clue.text)) return false;
  lead.clues.push({ at: now, text: clue.text, from: clue.from });
  const next = Math.max(rules.minRadiusM, lead.radiusM * rules.shrink);
  if (clue.toward) {
    // Move the middle no further than keeps the old circle's spot inside the new one.
    const c = worldChart(lead.center);
    const t = worldChart(clue.toward);
    const dx = t.x - c.x;
    const dy = t.y - c.y;
    const dist = Math.hypot(dx, dy);
    const step = Math.min(dist, Math.max(0, dist - next * 0.5));
    if (dist > 0 && step > 0) {
      lead.center = worldGeo({ x: c.x + (dx / dist) * step, y: c.y + (dy / dist) * step });
    }
  }
  lead.radiusM = next;
  return true;
}

export function closeLead(lead: Lead, outcome: 'found' | 'cold', now: number): boolean {
  if (lead.closed) return false;
  lead.closed = { at: now, outcome };
  return true;
}

/**
 * Legend tales heard become leads (plan 11 §8, §18.4 piece T: "rumors heard in an old save
 * count as the first clue"): one per legend, opened by its first telling, with a circle
 * round where the tale sets it. Returns the leads opened.
 */
export function legendLeads(
  leads: Lead[],
  rumors: readonly {
    kind: string;
    draft: string;
    text: string;
    heardAt: number;
    port?: string | undefined;
  }[],
  names: ReadonlyMap<string, string>,
  portName: (id: string) => string,
): Lead[] {
  const out: Lead[] = [];
  // Oldest telling first, so the lead's first clue is the first you heard.
  const told = [...rumors].filter((r) => r.kind === 'legend').sort((a, b) => a.heardAt - b.heardAt);
  for (const r of told) {
    if (findLead(leads, r.draft)) continue;
    const area = discoveriesFile().legends.find((l) => l.id === r.draft);
    if (!area) continue;
    out.push(
      openLead(
        leads,
        {
          id: r.draft,
          kind: 'legend',
          title: names.get(r.draft) ?? r.draft,
          where: area.where,
          center: area.at,
          radiusM: area.radiusM,
          clue: { text: r.text, from: r.port ? `saloon talk in ${portName(r.port)}` : 'talk' },
        },
        r.heardAt,
      ),
    );
  }
  return out;
}

// --- Curios.

/** A curio got; false when you have it already (each is one of a kind). */
export function giveCurio(curios: CurioState[], id: string, from: string, now: number): boolean {
  if (!curioDef(id) || curios.some((c) => c.id === id)) return false;
  curios.push({ id, gotAt: now, from });
  return true;
}

/** Set out at a hideout (`hideout`), or taken back aboard (undefined). */
export function showCurio(curios: CurioState[], id: string, hideout: string | undefined): boolean {
  const c = curios.find((k) => k.id === id);
  if (!c) return false;
  if (hideout) c.shownAt = hideout;
  else delete c.shownAt;
  return true;
}

/** The pieces a curio can be set out on, and how many each holds. */
export const DISPLAY_PIECES: Readonly<Record<string, number>> = {
  'build.shelving': 1,
  'build.table': 2,
  'build.chest': 1,
  'build.curio_shelf': 2,
};

/**
 * Where a curio sits on each display piece (Phase 9 piece P), in the piece's own frame:
 * the gap on the shelving's top shelf, two places on a table's top clear of its jug and
 * cup, the middle of a sea chest's lid. Meters; y up from the piece's foot.
 */
const DISPLAY_SPOTS: Readonly<
  Record<string, readonly { x: number; y: number; z: number; wall?: boolean }[]>
> = {
  'build.shelving': [{ x: 0.64, y: 1.94, z: 0.6 }],
  'build.table': [
    { x: -0.5, y: 0.8, z: 0.2 },
    { x: 0.55, y: 0.8, z: -0.2 },
  ],
  'build.chest': [{ x: 0, y: 0.53, z: 0 }],
  // The wall shelf's plank, its back to the wall at +z (as the wall lantern's bracket).
  'build.curio_shelf': [
    { x: -0.35, y: 1.43, z: -0.02, wall: true },
    { x: 0.35, y: 1.43, z: -0.02, wall: true },
  ],
};

/**
 * Curios that want a wall behind them: the nameboard and the medal on its plaque stand
 * up against it, the spyglass lies along it. They take a wall shelf's places first.
 */
export const WALL_CURIOS: ReadonlySet<string> = new Set([
  'curio.nameboard',
  'curio.trade_medal',
  'curio.keepers_spyglass',
]);

/** A display place in a hideout, site meters, and the yaw of the piece it's on (radians). */
export interface CurioSlot {
  x: number;
  y: number;
  z: number;
  yaw: number;
  /** On a wall shelf, against the wall. */
  wall?: boolean;
}

/**
 * The places a hideout's built display pieces offer, in the order the curios fill them
 * (the order the pieces were placed). `pieces` are as the renderer gets them (`yawDeg`
 * or 90° `rot` steps, clockwise from above), so the slots land on what's drawn.
 */
export function curioSlots(
  pieces: readonly {
    id: string;
    built: boolean;
    x: number;
    y: number;
    z: number;
    rot: number;
    yawDeg?: number;
  }[],
): CurioSlot[] {
  const out: CurioSlot[] = [];
  for (const p of pieces) {
    const spots = p.built ? DISPLAY_SPOTS[p.id] : undefined;
    if (!spots) continue;
    // The same turn the hideout view gives the piece: three.js yaw, counter-clockwise.
    const yaw = -(((p.yawDeg ?? p.rot * 90) * Math.PI) / 180);
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    for (const o of spots) {
      const slot: CurioSlot = {
        x: p.x + o.x * c + o.z * s,
        y: p.y + o.y,
        z: p.z - o.x * s + o.z * c,
        yaw,
      };
      if (o.wall) slot.wall = true;
      out.push(slot);
    }
  }
  return out;
}

/**
 * Which curio goes where: in the order they were set out, each takes the first free place
 * of the kind it wants (a wall for the `WALL_CURIOS`, a shelf, table or chest for the
 * rest), then any free place; past the places there are, none.
 */
export function placeCurios(
  ids: readonly string[],
  slots: readonly CurioSlot[],
): { id: string; slot: CurioSlot }[] {
  const taken = new Set<number>();
  const at = new Map<string, number>();
  const take = (id: string, ok: (s: CurioSlot) => boolean): void => {
    if (at.has(id)) return;
    const k = slots.findIndex((s, i) => !taken.has(i) && ok(s));
    if (k < 0) return;
    taken.add(k);
    at.set(id, k);
  };
  for (const id of ids) take(id, (s) => !!s.wall === WALL_CURIOS.has(id));
  for (const id of ids) take(id, () => true);
  return ids.flatMap((id) => {
    const k = at.get(id);
    const slot = k === undefined ? undefined : slots[k];
    return slot ? [{ id, slot }] : [];
  });
}

/** How many curios a hideout's built pieces can show (its shelves, tables and sea chests). */
export function displaySpaces(layout: {
  palette: readonly string[];
  built: readonly number[];
}): number {
  let n = 0;
  // Packed seven numbers a piece, the first its palette index (`hideouts/grid`).
  for (let i = 0; i + 7 <= layout.built.length; i += 7) {
    const id = layout.palette[layout.built[i] ?? -1];
    if (id) n += DISPLAY_PIECES[id] ?? 0;
  }
  return n;
}
