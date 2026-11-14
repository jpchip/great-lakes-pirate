import type { ArenaLand } from '../sim/arena/land';
import { separateSteeredFromLand } from '../sim/arena/land-separation';
import type { SteeredShip } from '../sim/arena/steering';
import type { GameContext } from '../modes/context';
import type { Entity } from './ecs';

export interface LandSteered {
  entity: Entity;
  steer: SteeredShip;
  land: ArenaLand;
}

export interface LandSeparationDeps {
  ctx: GameContext;
  steered: () => readonly LandSteered[];
}

export interface LandSeparation {
  step(dt: number): void;
}

/** After hull collisions, keep steered NPCs from riding up onto the shore. */
export function attachLandSeparation(deps: LandSeparationDeps): LandSeparation {
  return {
    step(dt) {
      if (dt <= 0) return;
      const seen = new Set<Entity>();
      for (const { entity, steer, land } of deps.steered()) {
        if (seen.has(entity)) continue;
        seen.add(entity);
        const t = entity.transform;
        if (!t) continue;
        const prev = entity.previousTransform?.position ?? t.position;
        steer.x = t.position.x;
        steer.z = t.position.z;
        steer.heading = t.heading;
        separateSteeredFromLand(steer, land, prev, dt);
        t.position.x = steer.x;
        t.position.z = steer.z;
        if (entity.velocity) {
          entity.velocity.x = steer.vx;
          entity.velocity.z = steer.vz;
        }
        if (entity.npc) entity.npc.speedKn = steer.helm.speedKn;
      }
    },
  };
}