import { DEFAULT_COMPRESSION, knotsToMs, sceneSpeed } from '../../core/coords';
import type { InputMapper } from '../../core/input';
import { R_SAILING } from '../../core/time';
import { schoonerBuoyancy } from '../../gameplay/buoyancy';
import { cloneTransform, type GameWorld, type Transform } from '../../gameplay/ecs';
import { createSchooner, type Schooner } from '../../gameplay/schooner';
import type { Contact, Encounter } from '../../sim/chart/traffic';
import type { ChartWind } from '../../sim/chart/voyage';
import { FULL_SAIL, updateTargetSpeed, type SailingWind } from '../../sim/sailing/controller';

/**
 * The open-water arena for prototype S8 (plan 03 §6.3): an empty ~3 × 3 km patch of
 * compressed water with the player and whatever was met. The player's T1 schooner sails
 * on the plan 02 controller and hazards (open water: no ground), in the chart's wind;
 * the arena mode runs the sailing and hazard systems and `stepArena` does the rest.
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

export type ArenaResult = 'left' | 'resolved' | 'caught';

export interface ArenaState {
  contact: Contact;
  forced: boolean;
  wind: ChartWind;
  /** The same wind, as the sailing model takes it. */
  sailingWind: SailingWind;
  player: Transform;
  schooner: Schooner;
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
 * they were sighted from, bow toward the contact, under full sail at the speed the wind
 * gives that heading. A squall surrounds you instead.
 */
export function createArenaState(enc: Encounter, chartWind: ChartWind): ArenaState {
  const c = enc.contact;
  const hasTarget = c.kind !== 'storm';
  const range = !hasTarget ? 0 : enc.forced ? 520 : 650;
  // enc.bearing is player → contact; the player sits on the reciprocal.
  const px = -Math.sin(enc.bearing) * range;
  const pz = Math.cos(enc.bearing) * range;
  // A squall brings its own wind.
  const wind =
    c.kind === 'storm'
      ? { from: chartWind.from, speedKn: Math.max(chartWind.speedKn, 26) }
      : chartWind;
  const sailingWind: SailingWind = { fromRad: wind.from, speedKn: wind.speedKn, gust01: 0 };
  const schooner = createSchooner(px, pz, enc.bearing);
  const s = schooner.sailing.state;
  // Arrive as you sailed on the chart: everything set, already making way.
  s.sailLevel = s.sailSetting = FULL_SAIL;
  s.speed = Math.max(updateTargetSpeed(s, schooner.sailing.cls, sailingWind, 0), 0);
  return {
    contact: c,
    forced: enc.forced,
    wind,
    sailingWind,
    player: { position: { x: px, y: 0, z: pz }, heading: enc.bearing },
    schooner,
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
    buoyancy: state.schooner.buoyancy,
    sailing: state.schooner.sailing,
    hazards: state.schooner.hazards,
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

/**
 * One fixed tick of arena gameplay, after the sailing and hazard systems have moved the
 * player. Sets `result` when the arena is over.
 */
export function stepArena(state: ArenaState, input: InputMapper, dt: number): void {
  if (state.result) return;
  state.elapsed += dt;
  const p = state.player;

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
