import { DEFAULT_COMPRESSION, knotsToMs, sceneSpeed } from '../../core/coords';
import { R_SAILING } from '../../core/time';
import { createCurve, sampleCurve, type Curve } from '../sailing/curve';
import type { ShipRecord } from '../../../data/schemas/ships';
import type { ArenaLand } from './land';

/**
 * NPC helms in an arena (plan 03 §6.3, Phase 3 piece G): each ship holds its lane's
 * course at its service speed, gives way to anything it would pass too close to by
 * turning to starboard (the rule of the road), steers clear of land it can see coming,
 * and comes back to its course once clear. The cutter, when hunting, runs the player
 * down on a lead course instead. Plain math on plain objects, so it unit-tests.
 */

const DEG = Math.PI / 180;

/** Look this far ahead (seconds) for a close quarters situation. */
export const AVOID_HORIZON_S = 75;
/** Pass at least this much clear of the other hull's ends, meters. */
export const PASSING_MARGIN_M = 70;
/** Give way by this much to starboard of the other ship's bearing. */
const GIVE_WAY_RAD = 65 * DEG;
/** Look for land this many seconds ahead, and never less than this many meters. */
const LAND_LOOKAHEAD_S = 40;
const LAND_LOOKAHEAD_MIN_M = 220;
/** Hold an avoiding turn this long after the danger clears, so helms don't flutter. */
const STEADY_S = 6;

/** The helm's own state; the entity's transform and velocity are what it steers. */
export interface NpcHelm {
  /** The lane's course, radians: where it steers when nothing is in the way. */
  course: number;
  /** Service speed through the water, game knots (0 for a derelict). */
  serviceKn: number;
  /** Current speed, game knots. */
  speedKn: number;
  lengthM: number;
  accelTau: number;
  decelTau: number;
  turnRate: Curve;
  /** Runs the player down instead of holding a course. */
  hunting: boolean;
  /**
   * The law's orders (Phase 5 piece C), set each tick by her captain (`sim/law/cutter.ts`):
   * when present they replace `hunting`. `intercept` runs the player down, `alongside`
   * comes up on her beam and matches her speed, `search` makes for where she was last
   * seen, `standOff` lies off the shallows she won't enter, `stop` heaves to.
   */
  orders?:
    | { mode: 'course' }
    | { mode: 'intercept' }
    | { mode: 'alongside' }
    | { mode: 'search'; at: { x: number; z: number } }
    | { mode: 'standOff' }
    | { mode: 'stop' };
  /** Draws too much for the shallows: steers clear of shoal water as of land. */
  deepDraft?: boolean;
  /** The heading it's steering for right now; read by tests and the dev overlay. */
  desired: number;
  /** Seconds left holding an avoiding course after the danger cleared. */
  steadyS: number;
  /** What it's doing, for the dev overlay and tests. */
  state: 'course' | 'giveWay' | 'land' | 'hunt' | 'stopped';
}

export function createHelm(
  record: ShipRecord,
  course: number,
  speedKn: number,
  hunting = false,
): NpcHelm {
  return {
    course,
    serviceKn: speedKn,
    speedKn,
    lengthM: record.lengthM * record.displayScale,
    accelTau: record.accelTau,
    decelTau: record.decelTau,
    turnRate: createCurve(record.turnRateCurve),
    hunting,
    desired: course,
    steadyS: 0,
    state: speedKn > 0 ? 'course' : 'stopped',
  };
}

/** A vessel the helms watch: position and velocity in zone meters and scene m/s. */
export interface Traffic {
  x: number;
  z: number;
  vx: number;
  vz: number;
  lengthM: number;
}

export interface SteeredShip extends Traffic {
  heading: number;
  helm: NpcHelm;
}

/** Signed smallest angle a → b, radians. */
export function angleDiff(a: number, b: number): number {
  return Math.atan2(Math.sin(b - a), Math.cos(b - a));
}

function wrap(a: number): number {
  const t = a % (Math.PI * 2);
  return t < 0 ? t + Math.PI * 2 : t;
}

/** Closest point of approach of `b` relative to `a`: time (s, ≥ 0) and distance (m). */
export function closestApproach(a: Traffic, b: Traffic): { t: number; d: number } {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const vx = b.vx - a.vx;
  const vz = b.vz - a.vz;
  const v2 = vx * vx + vz * vz;
  const t = v2 < 1e-9 ? 0 : Math.max(0, -(dx * vx + dz * vz) / v2);
  return { t, d: Math.hypot(dx + vx * t, dz + vz * t) };
}

/** Scene speed in m/s for game knots in the arena (R = 24, C = 8, as in a zone). */
export function arenaSceneSpeed(kn: number): number {
  return sceneSpeed(knotsToMs(kn), R_SAILING, DEFAULT_COMPRESSION);
}

function landAhead(land: ArenaLand, s: SteeredShip, heading: number): boolean {
  const shoal = s.helm.deepDraft && land.isShoal && !land.allDeep ? land.isShoal : undefined;
  if (land.allWater && !shoal) return false;
  const reach = Math.max(LAND_LOOKAHEAD_MIN_M, arenaSceneSpeed(s.helm.speedKn) * LAND_LOOKAHEAD_S);
  const fx = Math.sin(heading);
  const fz = -Math.cos(heading);
  for (const f of [0.25, 0.5, 0.75, 1]) {
    const x = s.x + fx * reach * f;
    const z = s.z + fz * reach * f;
    if (land.isLand(x, z) || shoal?.(x, z)) return true;
  }
  return false;
}

/** Her course for the law's orders, and the speed she wants, knots (undefined: service). */
function orderedCourse(
  s: SteeredShip,
  player: Traffic,
  orders: NonNullable<NpcHelm['orders']>,
): { want: number; kn?: number; chase: boolean } | undefined {
  const h = s.helm;
  const range = Math.hypot(player.x - s.x, player.z - s.z);
  const playerKn = Math.hypot(player.vx, player.vz) / Math.max(arenaSceneSpeed(1), 1e-6);
  const toward = (x: number, z: number): number => Math.atan2(x - s.x, -(z - s.z));
  switch (orders.mode) {
    case 'course':
      return undefined;
    case 'stop':
      return { want: s.heading, kn: 0, chase: true };
    case 'intercept': {
      const v = arenaSceneSpeed(h.serviceKn);
      const lead = Math.min(range / Math.max(v, 0.1), 60);
      // Close aboard, run alongside rather than ramming.
      if (range < 90) return alongside(s, player, playerKn);
      return {
        want: toward(player.x + player.vx * lead, player.z + player.vz * lead),
        chase: true,
      };
    }
    case 'alongside':
      return alongside(s, player, playerKn);
    case 'search':
      return { want: toward(orders.at.x, orders.at.z), kn: h.serviceKn * 0.6, chase: true };
    case 'standOff':
      // Head for her, slowly; the shoal check turns her off before she touches.
      return {
        want: toward(player.x, player.z),
        kn: range < 400 ? 0 : h.serviceKn * 0.35,
        chase: true,
      };
  }
}

/** A station 40 m off the player's beam, on the side she's on, at the player's speed. */
function alongside(
  s: SteeredShip,
  player: Traffic,
  playerKn: number,
): { want: number; kn: number; chase: boolean } {
  const ph =
    Math.hypot(player.vx, player.vz) > 0.05 ? Math.atan2(player.vx, -player.vz) : s.heading;
  // Which beam she's on: + is starboard of the player's heading.
  const side = Math.sign(Math.cos(ph) * (s.x - player.x) + Math.sin(ph) * (s.z - player.z) || 1);
  const tx = player.x + Math.cos(ph) * 40 * side;
  const tz = player.z + Math.sin(ph) * 40 * side;
  const d = Math.hypot(tx - s.x, tz - s.z);
  const want = d < 25 ? ph : Math.atan2(tx - s.x, -(tz - s.z));
  const kn = d < 60 ? playerKn : Math.min(s.helm.serviceKn, playerKn + 1 + d / 40);
  return { want, kn, chase: true };
}

/** The nearest clear heading to `want`, trying 20° steps either side; undefined if boxed in. */
function clearOfLand(land: ArenaLand, s: SteeredShip, want: number): number | undefined {
  if (!landAhead(land, s, want)) return want;
  for (let k = 1; k <= 8; k++) {
    for (const side of [1, -1]) {
      const h = want + side * k * 20 * DEG;
      if (!landAhead(land, s, h)) return h;
    }
  }
  return undefined;
}

/**
 * One tick for every NPC helm: choose a heading, turn toward it at the class's rate,
 * make the speed, and set the velocity the entity moves on. `player` is the player's
 * ship (the cutter hunts it; everyone gives way to it).
 */
export function steerShips(
  ships: readonly SteeredShip[],
  player: Traffic | undefined,
  land: ArenaLand,
  dt: number,
): void {
  for (const s of ships) {
    const h = s.helm;
    if (h.serviceKn <= 0) {
      h.state = 'stopped';
      h.speedKn = Math.max(0, h.speedKn - h.speedKn * (1 - Math.exp(-dt / h.decelTau)));
    } else {
      let want = h.course;
      let state: NpcHelm['state'] = 'course';
      let slow = false;
      let orderedKn: number | undefined;
      const ordered = player && h.orders ? orderedCourse(s, player, h.orders) : undefined;
      const chasing = h.orders ? !!ordered?.chase : h.hunting;
      if (ordered) {
        want = ordered.want;
        orderedKn = ordered.kn;
        state = 'hunt';
      } else if (h.hunting && player && !h.orders) {
        // Lead the player by the time it takes to close, capped so it doesn't overshoot.
        const v = arenaSceneSpeed(h.serviceKn);
        const range = Math.hypot(player.x - s.x, player.z - s.z);
        const lead = Math.min(range / Math.max(v, 0.1), 60);
        const tx = player.x + player.vx * lead;
        const tz = player.z + player.vz * lead;
        want = Math.atan2(tx - s.x, -(tz - s.z));
        state = 'hunt';
      }
      // Give way: the most pressing close-quarters situation decides the turn.
      let worst: { t: number; other: Traffic } | undefined;
      const others: Traffic[] = player && !chasing ? [player, ...ships] : [...ships];
      for (const o of others) {
        if (o === s) continue;
        const cpa = closestApproach(s, o);
        const safe = (s.lengthM + o.lengthM) / 2 + PASSING_MARGIN_M;
        if (cpa.t < AVOID_HORIZON_S && cpa.d < safe && (!worst || cpa.t < worst.t)) {
          worst = { t: cpa.t, other: o };
          if (cpa.t < 15 && cpa.d < safe * 0.5) slow = true;
        }
      }
      if (worst) {
        const toOther = Math.atan2(worst.other.x - s.x, -(worst.other.z - s.z));
        want = toOther + GIVE_WAY_RAD;
        state = 'giveWay';
        h.steadyS = STEADY_S;
      } else if (h.steadyS > 0 && !chasing) {
        // Hold the last avoiding heading a moment before coming back to the course.
        h.steadyS -= dt;
        want = h.desired;
        state = 'giveWay';
      }
      const clear = clearOfLand(land, s, want);
      if (clear === undefined) {
        state = 'stopped';
        slow = true;
      } else {
        if (clear !== want) {
          state = 'land';
          // A deep-draft ship feels her way round shoal water at half speed or less.
          if (h.deepDraft) slow = true;
        }
        want = clear;
      }
      h.desired = wrap(want);
      h.state = state;

      // Turn at the class's rate for its speed (plan 02 §4 curves), then make the speed.
      const rate = sampleCurve(h.turnRate, h.speedKn) * DEG;
      const d = angleDiff(s.heading, h.desired);
      s.heading = wrap(s.heading + Math.max(-rate * dt, Math.min(rate * dt, d)));
      const cruise = orderedKn === undefined ? h.serviceKn : Math.min(orderedKn, h.serviceKn);
      const target = state === 'stopped' ? 0 : slow ? cruise * 0.4 : cruise;
      const tau = target > h.speedKn ? h.accelTau : h.decelTau;
      h.speedKn += (target - h.speedKn) * (1 - Math.exp(-dt / tau));
    }
    let v = arenaSceneSpeed(h.speedKn);
    // Her keel is the last word: a deep-draft ship stops short of shoal water dead ahead
    // rather than run onto it, and turns off it from there.
    if (h.deepDraft && land.isShoal && !land.allDeep && v > 0) {
      const ahead = Math.max(60, v * 4);
      const x = s.x + Math.sin(s.heading) * ahead;
      const z = s.z - Math.cos(s.heading) * ahead;
      if (land.isShoal(x, z) || land.isLand(x, z)) {
        h.speedKn *= Math.exp(-dt / 2);
        v = arenaSceneSpeed(h.speedKn);
      }
    }
    s.vx = Math.sin(s.heading) * v;
    s.vz = -Math.cos(s.heading) * v;
  }
}
