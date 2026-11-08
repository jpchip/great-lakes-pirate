import { GRAVITY_MS2, type Vec3 } from './ballistics';
import { hitTest, type HitLocation, type HullPose, type HullShape } from './hull';

/**
 * Shot in the air (plan 07 §4.1; Phase 6 piece A): each round flies its arc, and each
 * tick the stretch it covered is tested against every ship's boxes and the sea. The first
 * thing it meets ends it. A ship's own shot never strikes her.
 */

export interface Shot {
  id: number;
  /** Who fired (an entity id: `ship.player`, a traffic ship, the cutter). */
  shooter: string;
  weapon: string;
  /** What it was loaded with (a warning shot keeps its id). */
  ammo: string;
  pos: Vec3;
  vel: Vec3;
  ageS: number;
}

/** A ship a shot can strike this tick. */
export interface ShotTarget {
  id: string;
  shape: HullShape;
  pose: HullPose;
}

export type ShotEnd =
  | { kind: 'water'; shot: Shot; at: Vec3 }
  | {
      kind: 'hit';
      shot: Shot;
      at: Vec3;
      target: string;
      location: HitLocation;
      /** The point struck in her local frame (`x` across, `z` along). */
      local: Vec3;
    };

/** A shot that hasn't come down in this long is dropped (it flew off the edge). */
const MAX_FLIGHT_S = 30;

export class ShotField {
  readonly live: Shot[] = [];
  private nextId = 1;

  constructor(private readonly gravity = GRAVITY_MS2) {}

  add(shot: Omit<Shot, 'id' | 'ageS'>): Shot {
    const s: Shot = {
      ...shot,
      id: this.nextId++,
      ageS: 0,
      pos: { ...shot.pos },
      vel: { ...shot.vel },
    };
    this.live.push(s);
    return s;
  }

  clear(): void {
    this.live.length = 0;
  }

  /**
   * Moves every shot `dt` seconds along its arc and ends those that struck a ship or the
   * water. `seaLevel` gives the water's height at a point (0 for a flat sea).
   */
  step(
    dt: number,
    targets: readonly ShotTarget[],
    seaLevel: (x: number, z: number) => number = () => 0,
  ): ShotEnd[] {
    const ends: ShotEnd[] = [];
    const g = this.gravity;
    for (let i = this.live.length - 1; i >= 0; i--) {
      const s = this.live[i] as Shot;
      const a = s.pos;
      const b = {
        x: a.x + s.vel.x * dt,
        y: a.y + s.vel.y * dt - 0.5 * g * dt * dt,
        z: a.z + s.vel.z * dt,
      };
      let best: ShotEnd | undefined;
      let bestT = Infinity;
      for (const t of targets) {
        if (t.id === s.shooter) continue;
        // Cheap reject: too far from her to reach this tick.
        const reach = t.shape.halfLength + Math.hypot(b.x - a.x, b.z - a.z) + 5;
        if (Math.abs(a.x - t.pose.x) > reach || Math.abs(a.z - t.pose.z) > reach) continue;
        const h = hitTest(a, b, t.shape, t.pose);
        if (h && h.t < bestT) {
          bestT = h.t;
          best = {
            kind: 'hit',
            shot: s,
            at: lerp(a, b, h.t),
            target: t.id,
            location: h.location,
            local: h.local,
          };
        }
      }
      // The sea, where the stretch crosses it, if before any hull.
      const level = seaLevel(b.x, b.z);
      if (b.y <= level) {
        const ta = a.y - level;
        const tw = ta <= 0 ? 0 : ta / (ta - (b.y - level));
        if (tw < bestT) best = { kind: 'water', shot: s, at: { ...lerp(a, b, tw), y: level } };
      }
      s.ageS += dt;
      s.vel.y -= g * dt;
      s.pos = b;
      if (best || s.ageS > MAX_FLIGHT_S) {
        this.live.splice(i, 1);
        if (best) ends.push(best);
      }
    }
    return ends;
  }
}

function lerp(a: Vec3, b: Vec3, t: number): Vec3 {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
}
