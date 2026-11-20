import type { Rng } from '../../core/rng';
import type { PlacedResident } from '../../sim/islands/on-foot';
import type { OnFootZone } from './controller';
import type { GuardSpawn, Route } from './guards';
import { NavGrid, type NavQuery, type XZ } from './nav';
import { isDown, type Guard, type Stealth } from './stealth';

/**
 * The islands' residents (plan 11 §3.3, §18.4 piece Q): the fishermen, farmers and La
 * Pointe's villagers, put on the watch's machinery as the keepers are (`createStealth`, the
 * keepers' sight and hearing from `npc_types.json`). They don't chase: seeing something
 * amiss, they report it as `townsfolk`, and the word goes as fast as it can leave the
 * island (its light's keeper, or a boat to town at dawn). By day each walks his round, the
 * `resident` marks of his home and his own stops; by night they're indoors asleep.
 *
 * What's here is shared by the station's watch (keepers and residents on one island) and
 * the island watch (residents alone): their spawns, the patch of ground each walks, whose
 * yard you're in, and a word with one by day.
 */

/** Ground walked round a resident's round, meters past its farthest stops. */
export const RESIDENT_NAV_MARGIN_M = 24;
/** You're close enough to talk with a resident. */
export const TALK_M = 2.2;

/** A guard's name for a resident: "the fisherman, Hans Olsen". */
export function residentName(r: Pick<PlacedResident, 'kind' | 'name'>): string {
  return `the ${r.kind}, ${r.name}`;
}

/** Just the man's own name, from a guard's ("the fisherman, Hans Olsen" → "Hans Olsen"). */
export function ownName(guardName: string): string {
  return guardName.replace(/^the [a-z ]+, /, '');
}

/** Each resident's patch of ground: his round's box with room round it. */
export function residentBox(
  r: PlacedResident,
  marginM = RESIDENT_NAV_MARGIN_M,
): { minX: number; minZ: number; maxX: number; maxZ: number } {
  const xs = r.route.map((p) => p.x);
  const zs = r.route.map((p) => p.z);
  return {
    minX: Math.min(...xs) - marginM,
    minZ: Math.min(...zs) - marginM,
    maxX: Math.max(...xs) + marginM,
    maxZ: Math.max(...zs) + marginM,
  };
}

/**
 * Several local nav grids answering as one (a station's and each resident's patch), so a
 * whole island needn't be gridded at a meter for a few people who keep to their places.
 * A path is found on the grid that holds both ends; a search sweeps the grid it's in.
 */
export class LocalNavs implements NavQuery {
  constructor(readonly grids: readonly NavGrid[]) {}

  private holds(g: NavGrid, p: XZ): boolean {
    return (
      p.x >= g.minX &&
      p.z >= g.minZ &&
      p.x < g.minX + g.cols * g.cellM &&
      p.z < g.minZ + g.rows * g.cellM
    );
  }

  findPath(from: XZ, to: XZ): XZ[] | undefined {
    for (const g of this.grids) {
      if (this.holds(g, from) && this.holds(g, to)) {
        const path = g.findPath(from, to);
        if (path) return path;
      }
    }
    return undefined;
  }

  walkable(p: XZ): boolean {
    return this.grids.some((g) => g.walkable(p));
  }

  randomNear(p: XZ, radiusM: number, rng: Rng): XZ | undefined {
    for (const g of this.grids) {
      if (this.holds(g, p)) {
        const q = g.randomNear(p, radiusM, rng);
        if (q) return q;
      }
    }
    return undefined;
  }
}

/** A grid for each resident's patch of the island, at a meter. */
export function residentGrids(zone: OnFootZone, residents: readonly PlacedResident[]): NavGrid[] {
  return residents
    .filter((r) => r.route.length > 0)
    .map((r) => new NavGrid(zone, { ...residentBox(r), cellM: 1 }));
}

/** The walkable point nearest `p` within a few meters, on any grid. */
function snap(nav: NavQuery, p: XZ, reachM = 5): XZ | undefined {
  if (nav.walkable(p)) return p;
  for (let r = 0.5; r <= reachM; r += 0.5) {
    const n = Math.max(8, Math.round((2 * Math.PI * r) / 0.5));
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      const q = { x: p.x + Math.sin(a) * r, z: p.z - Math.cos(a) * r };
      if (nav.walkable(q)) return q;
    }
  }
  return undefined;
}

/** A resident's round by day: his stops snapped to ground he can stand on, in a loop. */
export function residentRoute(r: PlacedResident, nav: NavQuery): Route | undefined {
  const points = r.route.flatMap((p) => {
    const q = snap(nav, p);
    return q
      ? [{ x: q.x, z: q.z, waitS: p.waitS, ...(p.face !== undefined ? { face: p.face } : {}) }]
      : [];
  });
  return points.length ? { points, loop: true } : undefined;
}

/** The island's residents as guards, out on their rounds by day (none by night). */
export function residentSpawns(
  residents: readonly PlacedResident[],
  nav: NavQuery,
  night: boolean,
): GuardSpawn[] {
  if (night) return [];
  return residents.flatMap((r, i) => {
    const route = residentRoute(r, nav);
    return route
      ? [{ id: `resident.${r.id}`, type: r.type, name: residentName(r), route, startAt: i }]
      : [];
  });
}

/** Whose yard (a resident's home ground) you stand in, if anyone's. */
export function residentYard(
  residents: readonly PlacedResident[],
  at: XZ,
): PlacedResident | undefined {
  return residents.find(
    (r) => r.grounds && Math.hypot(at.x - r.grounds.x, at.z - r.grounds.z) <= r.grounds.radiusM,
  );
}

/** The resident a guard is, by its id. */
export function residentOf(
  residents: readonly PlacedResident[],
  g: Pick<Guard, 'id'>,
): PlacedResident | undefined {
  return residents.find((r) => `resident.${r.id}` === g.id);
}

/** A resident standing at his work near you, by day: one to talk with. */
export function residentToTalk(
  stealth: Stealth,
  residents: readonly PlacedResident[],
  at: XZ,
): { guard: Guard; resident: PlacedResident } | undefined {
  for (const g of stealth.guards) {
    if (g.state !== 'patrol' && g.state !== 'return') continue;
    const r = residentOf(residents, g);
    if (!r) continue;
    const gp = g.body.position;
    if (Math.hypot(gp.x - at.x, gp.z - at.z) > TALK_M) continue;
    return { guard: g, resident: r };
  }
  return undefined;
}

/** A resident's fate in the save (`residents[id]`), as a keeper's is kept. */
export interface ResidentFate {
  diedAt?: number | undefined;
  downUntil?: number | undefined;
  bribedUntil?: number | undefined;
}

/** The residents up and about at `t`: not dead, and not out cold or tied up still. */
export function residentsAbout(
  residents: readonly PlacedResident[],
  fates: Readonly<Record<string, ResidentFate>> | undefined,
  t: number,
): PlacedResident[] {
  return residents.filter((r) => {
    const f = fates?.[r.id];
    if (!f) return true;
    if (f.diedAt !== undefined) return false;
    return !(f.downUntil !== undefined && t < f.downUntil);
  });
}

/**
 * The residents' fates into the save as they happen (a dead man stays dead: nobody takes
 * his place in a year), and a bribe kept until it runs out.
 */
export function syncResidentFates(
  guards: readonly Guard[],
  fates: Record<string, ResidentFate>,
  t: number,
  nextDawn: (t: number) => number,
): void {
  for (const g of guards) {
    if (!g.id.startsWith('resident.')) continue;
    const id = g.id.slice('resident.'.length);
    const f = (fates[id] ??= {});
    if (g.state === 'dead') f.diedAt ??= t;
    else if (isDown(g.state)) f.downUntil = Math.max(g.untilGame, t + 60);
    else if (g.state === 'drunk') f.downUntil = Math.max(g.untilGame, g.sleepUntil, nextDawn(t));
    else if (g.state === 'bribed') f.bribedUntil = g.untilGame;
    if (Object.keys(f).length === 0) Reflect.deleteProperty(fates, id);
  }
}

/** What a resident says today: his lines in turn, a line a day. */
export function residentLine(r: Pick<PlacedResident, 'talk'>, day: number): string {
  return r.talk[((day % r.talk.length) + r.talk.length) % r.talk.length] ?? '';
}
