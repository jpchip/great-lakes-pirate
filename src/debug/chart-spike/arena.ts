import { DEFAULT_COMPRESSION, knotsToMs, sceneSpeed } from '../../core/coords';
import type { InputMapper } from '../../core/input';
import { R_SAILING } from '../../core/time';
import { schoonerBuoyancy } from '../../gameplay/buoyancy';
import { cloneTransform, type GameWorld, type Transform } from '../../gameplay/ecs';
import type { Contact, Encounter } from '../../sim/chart/traffic';
import { chartSpeedKn, type ChartShip, type ChartWind } from '../../sim/chart/voyage';

/**
 * The open-water arena for prototype S8 (plan 03 §6.3): an empty ~3 × 3 km patch of
 * compressed water with the player and whatever was met. The schooner is a kinematic
 * stand-in (steer and trim, speed from the same wind model as the chart) until the
 * plan 02 sailing controller lands.
 */

/** Half the arena's side: leave by sailing past ±1.5 km (plan 03 §6.3). */
export const ARENA_HALF_M = 1500;
/** A hostile within this range has you detected: the chart stays locked. */
export const PURSUIT_RANGE_M = 900;
/** The cutter's crew boards you inside this range. */
export const CAUGHT_RANGE_M = 45;
/** Get this close and hold Interact to resolve the encounter. */
export const INTERACT_RANGE_M = 140;
const INTERACT_HOLD_S = 1.5;
/** Riding out a squall takes this long. */
const STORM_RIDE_S = 40;
const TURN_RATE = 0.3;

export type ArenaResult = 'left' | 'resolved' | 'caught';

export interface ArenaState {
  contact: Contact;
  forced: boolean;
  wind: ChartWind;
  ship: ChartShip;
  player: Transform & { trim: number; speedKn: number; sceneSpeed: number };
  target: Transform | undefined;
  targetSpeed: number;
  elapsed: number;
  holdS: number;
  resolved: boolean;
  pursued: boolean;
  result: ArenaResult | undefined;
}

const scene = (kn: number): number => sceneSpeed(knotsToMs(kn), R_SAILING, DEFAULT_COMPRESSION);

/**
 * Lay out an arena: the contact near the middle, the player ~650 m off on the bearing
 * they were sighted from, bow toward the contact. A squall surrounds you instead.
 */
export function createArenaState(enc: Encounter, wind: ChartWind, ship: ChartShip): ArenaState {
  const c = enc.contact;
  const range = enc.forced ? 520 : 650;
  // enc.bearing is player → contact; the player sits on the reciprocal.
  const px = -Math.sin(enc.bearing) * range;
  const pz = Math.cos(enc.bearing) * range;
  const player = {
    position: { x: px, y: 0, z: pz },
    heading: enc.bearing,
    trim: 1,
    speedKn: 0,
    sceneSpeed: 0,
  };
  const hasTarget = c.kind !== 'storm';
  if (!hasTarget) {
    player.position.x = 0;
    player.position.z = 0;
  }
  return {
    contact: c,
    forced: enc.forced,
    // A squall brings its own wind.
    wind: c.kind === 'storm' ? { from: wind.from, speedKn: Math.max(wind.speedKn, 26) } : wind,
    ship,
    player,
    target: hasTarget ? { position: { x: 0, y: 0, z: 0 }, heading: c.heading } : undefined,
    // Laden ships plod in the arena so the prototype schooner can catch them; plan 07
    // owns real intercepts. The steam cutter holds one speed; the schooner outruns it only
    // on a good point of sail.
    targetSpeed:
      c.kind === 'derelict' ? 0 : c.hostile ? scene(c.speedKn * 0.65) : scene(c.speedKn * 0.45),
    elapsed: 0,
    holdS: 0,
    resolved: false,
    pursued: c.hostile,
    result: undefined,
  };
}

/** Put the arena's ships in the entity world so buoyancy can rock them. */
export function addArenaEntities(world: GameWorld, state: ArenaState): void {
  world.add({
    id: 'ship.player',
    transform: state.player,
    previousTransform: cloneTransform(state.player),
    buoyancy: schoonerBuoyancy(),
    model: 'schooner',
    playerControlled: true,
  });
  if (state.target) {
    const b = schoonerBuoyancy();
    if (state.contact.kind === 'freighter') {
      b.length = 80;
      b.beam = 12;
      b.heavePeriod = 6;
      b.pitchPeriod = 8;
      b.rollPeriod = 9;
    }
    world.add({
      id: state.contact.id,
      transform: state.target,
      previousTransform: cloneTransform(state.target),
      buoyancy: b,
    });
  }
}

export function distanceToTarget(state: ArenaState): number {
  if (!state.target) return Infinity;
  return Math.hypot(
    state.target.position.x - state.player.position.x,
    state.target.position.z - state.player.position.z,
  );
}

/** One fixed tick of arena gameplay. Sets `result` when the arena is over. */
export function stepArena(state: ArenaState, input: InputMapper, dt: number): void {
  if (state.result) return;
  state.elapsed += dt;
  const p = state.player;

  const steer = (input.isDown('SteerStarboard') ? 1 : 0) - (input.isDown('SteerPort') ? 1 : 0);
  if (input.pressed('TrimSailsOut')) p.trim = Math.min(p.trim + 0.25, 1);
  if (input.pressed('TrimSailsIn')) p.trim = Math.max(p.trim - 0.25, 0.25);
  p.speedKn = chartSpeedKn(p.heading, state.wind, state.ship) * p.trim;
  p.sceneSpeed = scene(p.speedKn);
  p.heading =
    (p.heading + steer * TURN_RATE * Math.min(p.sceneSpeed / 6, 1) * dt + Math.PI * 2) %
    (Math.PI * 2);
  p.position.x += Math.sin(p.heading) * p.sceneSpeed * dt;
  p.position.z -= Math.cos(p.heading) * p.sceneSpeed * dt;

  const t = state.target;
  const c = state.contact;
  if (t) {
    if (c.hostile && !state.resolved) {
      // The cutter steers straight for you.
      const desired = Math.atan2(p.position.x - t.position.x, -(p.position.z - t.position.z));
      const d = Math.atan2(Math.sin(desired - t.heading), Math.cos(desired - t.heading));
      t.heading += Math.max(Math.min(d, 0.25 * dt), -0.25 * dt);
    }
    t.position.x += Math.sin(t.heading) * state.targetSpeed * dt;
    t.position.z -= Math.cos(t.heading) * state.targetSpeed * dt;
  }

  const dist = distanceToTarget(state);
  state.pursued = c.hostile && !state.resolved && dist < PURSUIT_RANGE_M;
  if (c.hostile && dist < CAUGHT_RANGE_M) {
    state.result = 'caught';
    return;
  }

  if (!state.resolved) {
    if (c.kind === 'storm') {
      if (state.elapsed >= STORM_RIDE_S) state.resolved = true;
    } else if (!c.hostile && dist < INTERACT_RANGE_M && input.isDown('Interact')) {
      state.holdS += dt;
      if (state.holdS >= INTERACT_HOLD_S) state.resolved = true;
    } else {
      state.holdS = 0;
    }
  }

  const outside = Math.max(Math.abs(p.position.x), Math.abs(p.position.z)) > ARENA_HALF_M;
  if (outside && !state.pursued) {
    state.result = state.resolved ? 'resolved' : 'left';
    return;
  }
  // Back to the chart early once nothing is chasing you (a prototype shortcut).
  if (input.pressed('ToggleChart') && !state.pursued) {
    state.result = state.resolved ? 'resolved' : 'left';
  }
}

/** Interact progress 0–1 for the HUD. */
export function holdProgress(state: ArenaState): number {
  return Math.min(state.holdS / INTERACT_HOLD_S, 1);
}

/** Seconds left to ride out a squall. */
export function stormLeftS(state: ArenaState): number {
  return Math.max(STORM_RIDE_S - state.elapsed, 0);
}
