import { describe, expect, it } from 'vitest';
import { DEFAULT_COMPRESSION } from '../src/core/coords';
import { InputMapper } from '../src/core/input';
import { R_SAILING } from '../src/core/time';
import {
  addArenaEntities,
  createArenaState,
  stepArena,
  type ArenaState,
} from '../src/debug/chart-spike/arena';
import { createGameWorld, snapshotTransforms } from '../src/gameplay/ecs';
import { hazardSystem } from '../src/gameplay/hazards';
import { sailingSystem } from '../src/gameplay/sailing';
import type { Contact, ContactKind } from '../src/sim/chart/traffic';
import { IDLE_COMMAND, speedKn } from '../src/sim/sailing/controller';
import { IDLE_MOORING } from '../src/sim/sailing/hazards';
import { createSea } from '../src/sim/weather/waves';

const DEG = Math.PI / 180;
const scale = { rate: R_SAILING, compression: DEFAULT_COMPRESSION };

function contact(kind: ContactKind): Contact {
  return {
    id: `contact.${kind}`,
    kind,
    name: kind,
    pos: { x: 0, y: 0 },
    heading: 0,
    speedKn: kind === 'derelict' ? 0 : 9,
    conspicuity: 1,
    hostile: kind === 'cutter',
    threat: kind === 'cutter',
    prize: kind === 'freighter',
  };
}

/** Runs the arena the way the S8 mode does: sailing, hazards, then the arena rules. */
function run(state: ArenaState, seconds: number): void {
  const world = createGameWorld();
  addArenaEntities(world, state);
  const sea = createSea();
  const input = new InputMapper();
  input.context = 'sailing';
  const dt = 1 / 60;
  for (let i = 0; i < seconds * 60 && !state.result; i++) {
    snapshotTransforms(world);
    sailingSystem(
      world,
      () => IDLE_COMMAND,
      () => state.sailingWind,
      sea,
      scale,
      dt,
    );
    hazardSystem(
      world,
      () => IDLE_MOORING,
      { docks: [], berths: [] },
      () => state.sailingWind,
      scale,
      dt,
    );
    stepArena(state, input, dt);
  }
}

describe('S8 arena on the plan 02 controller', () => {
  // A northwest breeze; the freighter lies northeast, a beam reach away.
  const wind = { from: 315 * DEG, speedKn: 12 };
  const enc = { contact: contact('freighter'), forced: false, distanceM: 4000, bearing: 45 * DEG };

  it('arrives under full sail, already making way', () => {
    const state = createArenaState(enc, wind);
    const s = state.schooner.sailing.state;
    expect(s.sailSetting).toBe(3);
    expect(speedKn(s)).toBeGreaterThan(5);
  });

  it('sails the player toward the contact on the plan 02 model', () => {
    const state = createArenaState(enc, wind);
    const start = Math.hypot(state.player.position.x, state.player.position.z);
    run(state, 20);
    const end = Math.hypot(state.player.position.x, state.player.position.z);
    expect(end).toBeLessThan(start - 100);
    expect(state.player.heading).toBeCloseTo(state.schooner.sailing.state.heading, 6);
  });

  it('stalls in irons when the contact lies dead upwind', () => {
    const state = createArenaState({ ...enc, bearing: 315 * DEG }, wind);
    run(state, 20);
    const s = state.schooner.sailing.state;
    expect(s.inIrons || Math.abs(s.windAngle) < 60 * DEG).toBe(true);
    expect(speedKn(s)).toBeLessThan(3);
  });

  it('gives a squall its own strong wind', () => {
    const state = createArenaState({ ...enc, contact: contact('storm') }, wind);
    expect(state.sailingWind.speedKn).toBeGreaterThanOrEqual(26);
    expect(Math.hypot(state.player.position.x, state.player.position.z)).toBe(0);
  });
});
