import { Rng } from '../../core/rng';
import { sunAt } from '../../sim/weather/celestial';
import type { DistrictModel } from '../district/district';
import type { NavQuery, XZ } from './nav';

/**
 * Bayfield's daytime crowd (plan 08 §2.3, §20.8; Phase 7 piece K, 0.7.1): townsfolk and
 * dockhands about the waterfront while the sun is up, walking between the spots near the
 * district's `crowd` marks on the navmesh. They're scenery: no guard perceives them, they
 * aren't in the stealth layer, and they go home at dusk (none are drawn at night).
 */

export const CROWD_PER_MARK = 3;
/** A stroll, in meters a second. */
export const CROWD_WALK_MPS = 1.2;
/** How far a walker strolls from its mark, meters. */
export const CROWD_RADIUS_M = 12;
/** A pause at the end of each stroll, seconds. */
const PAUSE_S: readonly [number, number] = [3, 12];

export interface CrowdFigure {
  id: string;
  /** `npc.townsman` or `npc.dockhand`: how the figure is dressed (the view's looks). */
  type: 'npc.townsman' | 'npc.dockhand';
  x: number;
  y: number;
  z: number;
  heading: number;
}

export interface Crowd {
  /** How many figures walk the waterfront. */
  readonly count: number;
  step(dt: number): void;
  /** The figures to draw at this game time: none once the sun is down. */
  figures(gameSeconds: number): CrowdFigure[];
}

interface Walker {
  id: string;
  type: CrowdFigure['type'];
  anchor: XZ;
  rng: Rng;
  pos: XZ;
  heading: number;
  path: XZ[];
  pauseS: number;
}

/** Heading clockwise from north, as the district's figures face (forward is sin, -cos). */
function headingTo(from: XZ, to: XZ): number {
  return Math.atan2(to.x - from.x, -(to.z - from.z));
}

export function createCrowd(model: DistrictModel, nav: NavQuery, seed: string): Crowd | undefined {
  const anchors = model.marks.filter((m) => m.kind === 'crowd');
  if (anchors.length === 0) return undefined;
  const walkers: Walker[] = [];
  for (const mark of anchors) {
    for (let k = 0; k < CROWD_PER_MARK; k++) {
      const id = `crowd:${mark.id}:${k}`;
      const rng = Rng.fromSeed(`${seed}:${id}`);
      const anchor = { x: mark.x, z: mark.z };
      const start = nav.randomNear(anchor, CROWD_RADIUS_M, rng) ?? anchor;
      walkers.push({
        id,
        type: rng.chance(0.5) ? 'npc.dockhand' : 'npc.townsman',
        anchor,
        rng,
        pos: start,
        heading: 0,
        path: [],
        pauseS: rng.range(0, PAUSE_S[1]),
      });
    }
  }

  const newStroll = (w: Walker): void => {
    const goal = nav.randomNear(w.anchor, CROWD_RADIUS_M, w.rng);
    const path = goal ? nav.findPath(w.pos, goal) : undefined;
    if (path && path.length > 0) {
      w.path = path;
    } else {
      // No way there from here: stand a while and try again.
      w.path = [];
      w.pauseS = PAUSE_S[0];
    }
  };

  return {
    count: walkers.length,
    step(dt) {
      for (const w of walkers) {
        if (w.pauseS > 0) {
          w.pauseS = Math.max(0, w.pauseS - dt);
          continue;
        }
        const next = w.path[0];
        if (!next) {
          w.pauseS = w.rng.range(PAUSE_S[0], PAUSE_S[1]);
          newStroll(w);
          continue;
        }
        const dx = next.x - w.pos.x;
        const dz = next.z - w.pos.z;
        const d = Math.hypot(dx, dz);
        const stride = CROWD_WALK_MPS * dt;
        if (d <= stride) {
          w.pos = { x: next.x, z: next.z };
          w.path.shift();
        } else {
          w.pos = { x: w.pos.x + (dx / d) * stride, z: w.pos.z + (dz / d) * stride };
          w.heading = headingTo(w.pos, next);
        }
      }
    },
    figures(gameSeconds) {
      if (sunAt(gameSeconds).elevationRad <= 0) return [];
      return walkers.map((w) => ({
        id: w.id,
        type: w.type,
        x: w.pos.x,
        y: model.floorAt(w.pos.x, w.pos.z),
        z: w.pos.z,
        heading: w.heading,
      }));
    },
  };
}
