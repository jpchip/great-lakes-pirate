import type { ShipRecord } from '../../data/schemas/ships';
import type { GameContext } from '../modes/context';
import { collide, massOf, type Body } from '../sim/arena/collide';
import { arenaSceneSpeed, type NpcHelm } from '../sim/arena/steering';
import { SHIP_RECORDS, T1_SCHOONER_ID } from '../sim/sailing/ships';
import type { Entity } from './ecs';

/**
 * Hulls that block and bounce (Phase 6 piece C): after every ship has moved, the player's
 * and every NPC's hull are tested against each other, overlaps pushed apart by mass and
 * the closing speed taken off with a little bounce. A ship sailing her timetable in a zone
 * can't be pushed (she'd be put back next tick): she's an immovable hull, and you bounce
 * off her. A ram is a shove; there's no damage (plan 07 §12 cut list #2).
 */

/** Two hulls meeting at more than this, knots, is an event (audio, the log). */
const BUMP_KN = 0.3;
/** The same two hulls aren't reported again for this long, seconds. */
const BUMP_COOLDOWN_S = 2;

export interface CollisionDeps {
  ctx: GameContext;
  /** Whether a ship can be shoved (arena ships and zone ships off their timetables). */
  movable(e: Entity): boolean;
  /** Her helm, when someone steers her: a shove takes her way off too. */
  helmOf(e: Entity): NpcHelm | undefined;
}

export interface Collisions {
  /** Run after the ships have moved, before buoyancy. */
  step(dt: number): void;
}

function recordFor(ctx: GameContext, e: Entity): ShipRecord | undefined {
  const id =
    e.npc?.classId ?? (e.sailing ? (ctx.state.player.ship?.classId ?? T1_SCHOONER_ID) : undefined);
  return SHIP_RECORDS.find((r) => r.id === id);
}

export function attachCollisions(deps: CollisionDeps): Collisions {
  const { ctx } = deps;
  const knMs = arenaSceneSpeed(1);
  const cooldown = new Map<string, number>();
  let clock = 0;

  return {
    step(dt) {
      if (dt <= 0) return;
      clock += dt;
      const ents: Entity[] = [];
      const bodies: Body[] = [];
      for (const e of ctx.world.with('transform')) {
        if (!e.npc && !e.sailing) continue;
        // Alongside a pier the berth holds her: nothing shoves a docked ship.
        if (e.hazards?.state.berthId !== undefined) continue;
        const r = recordFor(ctx, e);
        if (!r) continue;
        const t = e.transform;
        const prev = e.previousTransform ?? t;
        const lengthM = r.lengthM * r.displayScale;
        const beamM = r.buoyancy.beam;
        ents.push(e);
        bodies.push({
          x: t.position.x,
          z: t.position.z,
          heading: t.heading,
          vx: (t.position.x - prev.position.x) / dt,
          vz: (t.position.z - prev.position.z) / dt,
          halfLengthM: lengthM / 2,
          halfBeamM: beamM / 2,
          mass: e.sailing || deps.movable(e) ? massOf(lengthM, beamM) : Infinity,
        });
      }
      if (bodies.length < 2) return;
      const before = bodies.map((b) => ({ vx: b.vx, vz: b.vz }));
      const contacts = collide(bodies);
      if (contacts.length === 0) return;
      const touched = new Set<number>();
      for (const c of contacts) {
        touched.add(c.a);
        touched.add(c.b);
        const kn = c.closingMs / knMs;
        const ia = ents[c.a]?.id ?? '?';
        const ib = ents[c.b]?.id ?? '?';
        const key = ia < ib ? `${ia}|${ib}` : `${ib}|${ia}`;
        if (kn > BUMP_KN && (cooldown.get(key) ?? -Infinity) <= clock) {
          cooldown.set(key, clock + BUMP_COOLDOWN_S);
          ctx.events.emit('ShipsCollided', { a: ia, b: ib, speedKn: Math.round(kn * 10) / 10 });
        }
      }
      for (const i of touched) {
        const e = ents[i] as Entity;
        const b = bodies[i] as Body;
        const v0 = before[i] as { vx: number; vz: number };
        const t = e.transform;
        if (!t) continue;
        t.position.x = b.x;
        t.position.z = b.z;
        const fx = Math.sin(t.heading);
        const fz = -Math.cos(t.heading);
        const along0 = v0.vx * fx + v0.vz * fz;
        const along1 = b.vx * fx + b.vz * fz;
        if (e.sailing) {
          const s = e.sailing.state;
          s.x = b.x;
          s.z = b.z;
          // Her way through the water scales with what's left of it along her heading.
          if (Math.abs(along0) > 1e-3) s.speed *= Math.max(-0.3, Math.min(1, along1 / along0));
          continue;
        }
        if (e.velocity) {
          e.velocity.x = b.vx;
          e.velocity.z = b.vz;
        }
        const kn = Math.max(0, along1 / knMs);
        const helm = deps.helmOf(e);
        if (helm) helm.speedKn = Math.min(helm.speedKn, kn);
        if (e.npc) e.npc.speedKn = Math.min(e.npc.speedKn, kn);
      }
    },
  };
}
