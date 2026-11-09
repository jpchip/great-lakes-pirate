import { performance } from 'node:perf_hooks';
import { expect, it } from 'vitest';
import { EventBus } from '../../src/core/events';
import { Rng } from '../../src/core/rng';
import { attachCombat, PLAYER_ID } from '../../src/gameplay/combat';
import {
  cloneTransform,
  createGameWorld,
  snapshotTransforms,
  velocitySystem,
  type Entity,
} from '../../src/gameplay/ecs';
import type { ShipHazards } from '../../src/gameplay/hazards';
import { createNpcShipEntity } from '../../src/gameplay/npc-ships';
import type { GameContext, GameEvents } from '../../src/modes/context';
import { SHIP_RECORDS } from '../../src/sim/sailing/ships';
import { createWorldState } from '../../src/sim/world-state';

/**
 * The combat bench (plan 07 §14.3 criterion 5; Phase 6 piece H): four ships firing for a
 * four-minute engagement, the longest the criterion allows. A T2 with every gun her class
 * mounts lays on whichever of three ships is in her arc each time a gun is loaded; the
 * three (a fish tug, a package steamer and the cutter, circling her at 120–260 m) each fire
 * the cutter's bow gun at her as often as it loads. Times the combat core's tick (every ball
 * in flight tested against every hull and the sea, damage, casualties, sinking) at 60 Hz
 * and prints one table. The captains' FSM and the law ride on the events and cost far less.
 */

const DEG = Math.PI / 180;
const HZ = 60;
const SECONDS = 240;
const record = (id: string) => {
  const r = SHIP_RECORDS.find((s) => s.id === id);
  if (!r) throw new Error(id);
  return r;
};

it('four ships firing for four minutes', () => {
  const state = createWorldState('bench-combat');
  const events = new EventBus<GameEvents>();
  const world = createGameWorld();
  const ctx = { state, events, world, rng: Rng.fromSeed('bench') } as unknown as GameContext;
  const transform = { position: { x: 0, y: 0, z: 0 }, heading: 0 };
  const player: Entity = world.add({
    id: PLAYER_ID,
    transform,
    previousTransform: cloneTransform(transform),
    velocity: { x: 0, y: 0, z: -3 },
    playerControlled: true,
  });
  const ship = state.player.ship;
  if (!ship) throw new Error('no ship');
  ship.classId = 'ship.t2_schooner';
  ship.weapons = [
    { weapon: 'weapon.rifle', mount: 'hand' },
    { weapon: 'weapon.swivel', mount: 'bow' },
    { weapon: 'weapon.light_cannon', mount: 'port' },
    { weapon: 'weapon.light_cannon', mount: 'port' },
    { weapon: 'weapon.light_cannon', mount: 'starboard' },
    { weapon: 'weapon.light_cannon', mount: 'starboard' },
  ];
  state.player.cargo.push({ good: 'good.powder_shot', qty: 400 });
  // A hull that never gives out, so the fight lasts the whole four minutes.
  const hazards = {
    cls: { hullHP: 1e9, riggingHP: 1e9 },
    state: { hull: 1e9, rigging: 1e9 },
  } as unknown as ShipHazards;

  const ring = [
    { id: 'npc.tug', classId: 'ship.fish_tug', r: 120, rate: 0.25 },
    { id: 'npc.steamer', classId: 'ship.package_steamer', r: 180, rate: -0.18 },
    { id: 'npc.cutter', classId: 'ship.cutter_morrill', r: 260, rate: 0.12 },
  ];
  const npcs = ring.map((s, i) => {
    const e = createNpcShipEntity(record(s.classId), s.r, 0, 0, 6);
    e.id = s.id;
    world.add(e);
    return { ...s, e, angle: (i * 2 * Math.PI) / 3 };
  });
  const combat = attachCombat({
    ctx,
    player,
    hazards,
    arena: () => undefined,
    zoneShips: () => npcs.map((n) => n.e).filter((e) => world.has(e)),
    hold: (id) => npcs.find((n) => n.id === id)?.e,
    zoneLand: () => undefined,
    isLawShip: () => false,
  });
  const count: Record<string, number> = {};
  events.tap((type) => (count[type] = (count[type] ?? 0) + 1));

  const dt = 1 / HZ;
  const ticks: number[] = [];
  let inFlight = 0;
  const nextShot = new Map<string, number>(npcs.map((n, i) => [n.id, 1 + i]));
  for (let f = 0; f < SECONDS * HZ; f++) {
    const t = f * dt;
    // The three circle her, each on her own ring.
    for (const n of npcs) {
      const tr = n.e.transform;
      if (!tr || !n.e.velocity) continue;
      n.angle += n.rate * dt;
      const p = transform.position;
      const x = p.x + Math.cos(n.angle) * n.r;
      const z = p.z + Math.sin(n.angle) * n.r;
      // On her ring, with the way she makes along it (for the guns' lead).
      n.e.velocity.x = -Math.sin(n.angle) * n.r * n.rate;
      n.e.velocity.z = Math.cos(n.angle) * n.r * n.rate;
      tr.position.x = x;
      tr.position.z = z;
      tr.heading = n.angle + (n.rate > 0 ? Math.PI : 0);
      // Her gun at the player as it loads (9 s), at a fixed elevation.
      if (t >= (nextShot.get(n.id) ?? 0)) {
        const bearing = Math.atan2(p.x - tr.position.x, -(p.z - tr.position.z));
        combat.fireFrom(n.e, 'weapon.cutter_gun', 'ammo.round', bearing, 2 * DEG, 'bow');
        nextShot.set(n.id, t + 9.5);
      }
    }
    // The player lays every loaded gun on whatever is in its arc, alternating shot.
    if (f % 6 === 0) {
      for (const n of npcs) {
        if (!world.has(n.e)) continue;
        combat.fire({ ammo: f % 12 === 0 ? 'ammo.chain' : 'ammo.grape', target: n.id });
        combat.fire({ ammo: 'ammo.round', target: n.id });
      }
    }
    snapshotTransforms(world);
    const t0 = performance.now();
    combat.step(dt);
    ticks.push(performance.now() - t0);
    inFlight = Math.max(inFlight, combat.shots().length);
    velocitySystem(world, dt);
  }
  ticks.sort((a, b) => a - b);
  const q = (p: number) => ticks[Math.min(ticks.length - 1, Math.floor(p * ticks.length))] ?? 0;
  const mean = ticks.reduce((a, b) => a + b, 0) / ticks.length;
  const lines = [
    `Combat core, four ships firing, ${SECONDS} s at ${HZ} Hz (${ticks.length} ticks)`,
    '',
    '| Mean | p50 | p95 | p99 | Max | Balls in flight (most) | Fired | Hits | Landed in the sea | Sunk |',
    '|---|---|---|---|---|---|---|---|---|---|',
    `| ${mean.toFixed(3)} ms | ${q(0.5).toFixed(3)} ms | ${q(0.95).toFixed(3)} ms | ${q(0.99).toFixed(3)} ms | ${q(1).toFixed(2)} ms | ${inFlight} | ${count.WeaponFired ?? 0} | ${count.ShipHit ?? 0} | ${(count.ShotLanded ?? 0) - (count.ShipHit ?? 0)} | ${count.ShipSunk ?? 0} |`,
  ];
  console.log(lines.join('\n'));
  expect(count.WeaponFired ?? 0).toBeGreaterThan(120);
  // The sailing tick's whole budget is a few ms; the combat core should be a sliver of it.
  expect(q(0.99)).toBeLessThan(1);
});
