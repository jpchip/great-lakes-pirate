import { ChartProjection, zoneToChart, type Chart, type Geo, type Zone } from '../../core/coords';
import { portInfo } from '../economy/defs';
import { defFrame, findZoneDef } from '../terrain/zones';
import type { WorldState } from '../world-state';
import type { LawDefs } from './defs';

/**
 * Which Wanted region a place is in (plan 06 §3.1; Phase 5 piece A). A port has its
 * region in `ports.json`; anywhere else on the water, a zone pose or a chart position,
 * goes to geography and `regions.json`'s areas.
 */

/** The world chart frame's projection (the save's, the zones', the weather's). */
const WORLD = new ChartProjection();

function inRing(p: Geo, ring: readonly Geo[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if (!a || !b) continue;
    if (a.lat > p.lat !== b.lat > p.lat) {
      const lon = a.lon + ((p.lat - a.lat) / (b.lat - a.lat)) * (b.lon - a.lon);
      if (p.lon < lon) inside = !inside;
    }
  }
  return inside;
}

/** The region a lon/lat point is in: the first area holding it, else the nearest anchor. */
export function regionAtGeo(defs: LawDefs, p: Geo): string {
  for (const r of defs.regions) if (r.areas.some((ring) => inRing(p, ring))) return r.id;
  const cos = Math.cos((p.lat * Math.PI) / 180);
  let best = defs.regions[0];
  if (!best) throw new Error('No Wanted regions');
  let bestD = Infinity;
  for (const r of defs.regions) {
    const d = Math.hypot((r.anchor.lon - p.lon) * cos, r.anchor.lat - p.lat);
    if (d < bestD) {
      bestD = d;
      best = r;
    }
  }
  return best.id;
}

/** A world chart frame point's region (chart travel, the weather's frame). */
export function regionAtChart(defs: LawDefs, p: Chart): string {
  return regionAtGeo(defs, WORLD.chartToGeo(p));
}

/** A zone point's region; undefined for a zone `zones.json` doesn't have (the test bay). */
export function regionAtZone(defs: LawDefs, zoneId: string, p: Zone): string | undefined {
  const def = findZoneDef(zoneId);
  if (!def) return undefined;
  return regionAtChart(defs, zoneToChart(p, defFrame(def)));
}

/** A port's region (`ports.json` `wantedRegion`). */
export function regionOfPort(port: string): string | undefined {
  return portInfo(port)?.wantedRegion;
}

/** Where the player is, for decay (away or present) and for crimes at sea. */
export function playerRegion(defs: LawDefs, state: WorldState): string | undefined {
  const loc = state.player.location;
  if (loc.mode === 'chart') return regionAtChart(defs, loc.chartPos);
  const def = findZoneDef(loc.zoneId);
  if (!def) return undefined;
  const pose = loc.pose ?? def.spawn;
  return regionAtZone(defs, loc.zoneId, { x: pose.x, z: pose.z });
}
