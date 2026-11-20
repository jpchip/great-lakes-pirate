import type { DistrictBuilding, DistrictModel } from '../district/district';
import type { CharacterState } from './controller';
import type { GuardSpawn, Route, Waypoint } from './guards';
import type { Lamp } from './light';
import type { NavQuery, XZ } from './nav';

/**
 * Bayfield's watch on its real district (plan 08 §5.1–5.2; Phase 7): who walks where, read
 * from the district's marks so the layout editor moves them, and the one placeholder rule
 * for when being seen is suspicious until piece E's conduct replaces it.
 *
 * - A **constable** walks the waterfront route (the `patrol` marks on `route.waterfront`).
 * - A second **constable** keeps the lockup (`post.lockup`): the law's post a watchman runs
 *   to, and the door the jailbreak (piece G) has to get past.
 * - A **watchman** with a lantern walks a beat round each other posted building
 *   (`post.<building>`): the post, then the middle of each wall a guard can reach.
 * - Wanted tiers add constables and marshals on the spare beats: the waterfront the other
 *   way round, and each half of it there and back (`rosterForTier`).
 */

export interface DistrictWatchPlan {
  base: GuardSpawn[];
  spareBeats: Route[];
  /** Where a watchman runs to find the law (the lockup's post). */
  lawPost: XZ | undefined;
}

/** Seconds a guard stops at a waypoint on the waterfront, at a beat's corner, at the post. */
const ROUTE_WAIT_S = 1.5;
const BEAT_WAIT_S = 3;
const POST_WAIT_S = 10;
/** How far outside a building's wall a beat walks, meters. */
const BEAT_OFFSET_M = 2.5;

const DEG = Math.PI / 180;

function routeIndex(id: string): number {
  const m = /_(\d+)$/.exec(id);
  return m ? Number(m[1]) : 0;
}

/** The marks of one patrol route, in order. */
export function routePoints(model: DistrictModel, route: string): Waypoint[] {
  return model.marks
    .filter((m) => m.kind === 'patrol' && m.ref === route)
    .sort((a, b) => routeIndex(a.id) - routeIndex(b.id))
    .map((m, k, all) => {
      // At a stop they look on along the way they're going, not round where they stand.
      const next = all[(k + 1) % all.length] ?? m;
      const face = Math.atan2(next.x - m.x, -(next.z - m.z));
      return { x: m.x, z: m.z, face, waitS: ROUTE_WAIT_S };
    });
}

/** A watchman's beat: the post, then the middle of each wall they can reach, round. */
function beatRound(b: DistrictBuilding, post: Waypoint, nav: NavQuery): Waypoint[] {
  const cx = (b.minX + b.maxX) / 2;
  const cz = (b.minZ + b.maxZ) / 2;
  const sides: Waypoint[] = [
    { x: cx, z: b.minZ - BEAT_OFFSET_M, face: 0, waitS: BEAT_WAIT_S },
    { x: b.maxX + BEAT_OFFSET_M, z: cz, face: Math.PI / 2, waitS: BEAT_WAIT_S },
    { x: cx, z: b.maxZ + BEAT_OFFSET_M, face: Math.PI, waitS: BEAT_WAIT_S },
    { x: b.minX - BEAT_OFFSET_M, z: cz, face: -Math.PI / 2, waitS: BEAT_WAIT_S },
  ].filter((p) => nav.walkable(p));
  // Round from the post, the side nearest it first.
  const start = sides.reduce(
    (best, p, k) =>
      Math.hypot(p.x - post.x, p.z - post.z) <
      Math.hypot((sides[best]?.x ?? 0) - post.x, (sides[best]?.z ?? 0) - post.z)
        ? k
        : best,
    0,
  );
  return [post, ...sides.slice(start), ...sides.slice(0, start)];
}

/** Bayfield's two constables, and the names any district falls back on. */
const DEFAULT_NAMES: Readonly<Record<string, string>> = {
  'constable.waterfront': 'Constable Duffy',
  'constable.lockup': 'Constable Ryan',
};

/** The district's patrol routes: the waterfront first, then the rest by name. */
export function patrolRoutes(model: DistrictModel): string[] {
  const refs = new Set<string>();
  for (const m of model.marks) if (m.kind === 'patrol' && m.ref) refs.add(m.ref);
  return [...refs].sort((a, b) =>
    a === 'route.waterfront' ? -1 : b === 'route.waterfront' ? 1 : a.localeCompare(b),
  );
}

export function planDistrictWatch(
  model: DistrictModel,
  nav: NavQuery,
  names: Readonly<Record<string, string>> = {},
): DistrictWatchPlan {
  const base: GuardSpawn[] = [];
  const nameOf = (id: string): string | undefined => names[id] ?? DEFAULT_NAMES[id];
  const waterfront = routePoints(model, 'route.waterfront');
  // A constable on each beat (Phase 9 piece X: Duluth has three): the waterfront's is
  // `constable.waterfront`, another's `constable.<route>`.
  const beats = patrolRoutes(model)
    .map((route) => ({ route, points: routePoints(model, route) }))
    .filter((b) => b.points.length > 1);
  for (const b of beats) {
    const id = `constable.${b.route.replace(/^route\./, '')}`;
    const name = nameOf(id);
    base.push({
      id,
      type: 'npc.constable',
      ...(name ? { name } : {}),
      route: { points: b.points, loop: true },
    });
  }
  let lawPost: XZ | undefined;
  for (const m of model.marks) {
    if (m.kind !== 'post') continue;
    const building = model.buildings.find((b) => b.def.id === m.ref);
    // At the post they watch the street, their back to the door they keep.
    const face = building
      ? Math.atan2(
          m.x - (building.minX + building.maxX) / 2,
          -(m.z - (building.minZ + building.maxZ) / 2),
        )
      : m.headingDeg * DEG;
    const post: Waypoint = { x: m.x, z: m.z, face, waitS: POST_WAIT_S };
    if (m.ref === 'lockup') {
      lawPost = { x: m.x, z: m.z };
      // The lockup's constable stands at the door and strolls a little way each side.
      const near = waterfront
        .map((p) => ({ p, d: Math.hypot(p.x - m.x, p.z - m.z) }))
        .filter((q) => q.d > 4 && q.d < 40)
        .sort((a, b) => a.d - b.d)
        .slice(0, 2)
        .map((q) => ({ ...q.p, waitS: BEAT_WAIT_S }));
      const name = nameOf('constable.lockup');
      base.push({
        id: 'constable.lockup',
        type: 'npc.constable',
        ...(name ? { name } : {}),
        route: { points: [post, ...near.flatMap((p) => [p, post])], loop: true },
      });
      continue;
    }
    if (!building) continue;
    base.push({
      id: `watchman.${building.def.id}`,
      type: 'npc.watchman',
      name: `The ${(building.def.name ?? building.def.id.replace(/_/g, ' ')).toLowerCase()}'s watchman`,
      route: { points: beatRound(building, post, nav), loop: true },
    });
  }
  const half = Math.ceil(waterfront.length / 2);
  const spareBeats: Route[] =
    waterfront.length > 1
      ? [
          { points: [...waterfront].reverse(), loop: true },
          { points: waterfront.slice(0, half + 1), loop: false },
          { points: waterfront.slice(half - 1), loop: false },
        ]
      : [];
  // The other beats the other way round, for the tier's extra men.
  for (const b of beats) {
    if (b.route !== 'route.waterfront')
      spareBeats.push({ points: [...b.points].reverse(), loop: true });
  }
  return { base, spareBeats, lawPost };
}

/** The district's street lamps as perception's lamps (lit after dark; see `lightLamps`). */
export function districtLamps(model: DistrictModel): Lamp[] {
  return model.lamps.map((l) => ({
    x: l.x,
    y: l.y,
    z: l.z,
    radiusM: l.radiusM,
    intensity: l.intensity,
    lit: false,
  }));
}

/** Gas lamps are lit when the sky's own light falls below this (as the guards' lanterns). */
export const LAMPS_LIT_BELOW = 0.3;

/**
 * Lights the lamps after dark. A doused one stays dark until it's relit (`stealth.ts`), and
 * dawn puts every lamp out and forgets which were doused: the lamplighter's round at dusk
 * lights them all again.
 */
export function lightLamps(lamps: readonly Lamp[], ambient01: number): void {
  const lit = ambient01 < LAMPS_LIT_BELOW;
  for (const l of lamps) {
    if (!lit) l.doused = false;
    l.lit = lit && !l.doused;
  }
}

/** Buildings anyone may be in: shops in hours, the saloon into the night. */
const PUBLIC_KINDS = new Set(['store', 'chandlery', 'office', 'saloon']);

export interface SuspectContext {
  model: DistrictModel;
  player: CharacterState;
  /** The hour of the day, 0–24. */
  hour: number;
  carrying?: boolean;
}

/**
 * Whether being seen here and now is suspicious (StealthInputs.suspect).
 *
 * A placeholder until piece E's conduct rules (`conduct.ts`) take over this one call: inside
 * a building that isn't open to the public now; out after dark crouching or running; or
 * carrying loot. Walking the street by day, or into an open shop, is nothing to look at.
 */
export function suspectAshore(c: SuspectContext): boolean {
  if (c.carrying) return true;
  const p = c.player.position;
  const night = c.hour < 6 || c.hour >= 21;
  const inside = c.model.buildingAt(p.x, p.y + 0.9, p.z);
  if (inside) {
    const kind = inside.def.kind;
    if (!PUBLIC_KINDS.has(kind)) return true;
    // Shops shut at night; the saloon stays open until two.
    if (night && !(kind === 'saloon' && (c.hour >= 21 || c.hour < 2))) return true;
  }
  if (night && (c.player.crouching || c.player.gait === 'run')) return true;
  return false;
}
