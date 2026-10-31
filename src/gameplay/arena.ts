import { SHIP_RECORDS } from '../sim/sailing/ships';
import {
  ARENA_BOUNDS,
  createArenaRun,
  stepArenaRun,
  type ArenaLayout,
  type ArenaRun,
} from '../sim/arena/arena';
import type { ArenaEncounter } from '../sim/arena/encounter';
import type { ArenaLand } from '../sim/arena/land';
import { createHelm, steerShips, type SteeredShip, type Traffic } from '../sim/arena/steering';
import type { TerrainBounds } from '../sim/terrain/zone-terrain';
import { createNpcShipEntity } from './npc-ships';
import type { Entity, GameWorld } from './ecs';

/**
 * An arena in play (Phase 3 piece G): the ships materialized as NPC entities with helms,
 * and the run's rules. The sailing mode calls `step` each tick before moving entities;
 * `holdBounds` keeps the player in while a hostile has them.
 */

const DEG = Math.PI / 180;
/** A derelict's list, radians. */
const DERELICT_LIST = 14 * DEG;

export interface ArenaShipEntity {
  entity: Entity;
  steer: SteeredShip;
}

export interface ArenaPlay {
  readonly encounter: ArenaEncounter;
  readonly run: ArenaRun;
  readonly ships: readonly ArenaShipEntity[];
  readonly land: ArenaLand;
  /** One tick: steer the ships, hold the player off land, apply the rules. */
  step(
    dt: number,
    player: Entity | undefined,
    controls: { lookHeld: boolean; chartPressed: boolean },
  ): void;
  /** Bounds the player is held inside, while pursued; undefined otherwise. */
  holdBounds(): TerrainBounds | undefined;
  /** Positions for the HUD's chips. */
  inputs(player: Entity | undefined): {
    player: { x: number; z: number };
    ships: { id: string; x: number; z: number; hunting: boolean }[];
  };
}

/** Make the arena's NPC entities and add them to the world. */
export function materializeArena(
  world: GameWorld,
  encounter: ArenaEncounter,
  layout: ArenaLayout,
  land: ArenaLand,
): ArenaPlay {
  const ships: ArenaShipEntity[] = [];
  for (const { ship, pose } of layout.ships) {
    const record = SHIP_RECORDS.find((r) => r.id === ship.classId);
    if (!record) throw new Error(`No ship class ${ship.classId}`);
    const entity = createNpcShipEntity(record, pose.x, pose.z, pose.heading, ship.speedKn);
    entity.id = ship.id;
    const npc = entity.npc;
    if (npc && ship.derelict) {
      npc.derelict = true;
      npc.listRad = DERELICT_LIST;
    }
    const hunting = encounter.hunting && ship.hostile === true;
    const steer: SteeredShip = {
      x: pose.x,
      z: pose.z,
      vx: entity.velocity?.x ?? 0,
      vz: entity.velocity?.z ?? 0,
      heading: pose.heading,
      lengthM: record.lengthM * record.displayScale,
      helm: createHelm(record, ship.heading, ship.speedKn, hunting),
    };
    world.add(entity);
    ships.push({ entity, steer });
  }

  const run = createArenaRun(encounter);
  const traffic: Traffic = { x: 0, z: 0, vx: 0, vz: 0, lengthM: 30 };
  const playerTraffic = (player: Entity | undefined, dt: number): Traffic | undefined => {
    const t = player?.transform;
    if (!t) return undefined;
    const prev = player.previousTransform ?? t;
    traffic.x = t.position.x;
    traffic.z = t.position.z;
    // The player's velocity from this tick's move (the sailing system has run).
    traffic.vx = (t.position.x - prev.position.x) / dt;
    traffic.vz = (t.position.z - prev.position.z) / dt;
    return traffic;
  };
  const inputs: ArenaPlay['inputs'] = (player) => {
    const p = player?.transform?.position ?? { x: 0, z: 0 };
    return {
      player: { x: p.x, z: p.z },
      ships: ships.map(({ entity, steer }) => ({
        id: entity.id ?? '',
        x: steer.x,
        z: steer.z,
        hunting: steer.helm.hunting,
      })),
    };
  };

  return {
    encounter,
    run,
    ships,
    land,
    step(dt, player, controls) {
      for (const { entity, steer } of ships) {
        const t = entity.transform;
        if (!t) continue;
        steer.x = t.position.x;
        steer.z = t.position.z;
        steer.heading = t.heading;
      }
      steerShips(
        ships.map((s) => s.steer),
        playerTraffic(player, dt),
        land,
        dt,
      );
      for (const { entity, steer } of ships) {
        if (entity.transform) entity.transform.heading = steer.heading;
        if (entity.velocity) {
          entity.velocity.x = steer.vx;
          entity.velocity.z = steer.vz;
        }
        if (entity.npc) entity.npc.speedKn = steer.helm.speedKn;
      }

      // Land seen from the chart is a wall here: the arena has no shallows to ground in.
      const t = player?.transform;
      const s = player?.sailing?.state;
      if (t && s && land.isLand(s.x, s.z)) {
        const prev = player.previousTransform ?? t;
        s.x = t.position.x = prev.position.x;
        s.z = t.position.z = prev.position.z;
        s.speed *= 0.3;
      }

      stepArenaRun(run, { ...inputs(player), ...controls }, dt);
    },
    holdBounds() {
      return run.pursued ? ARENA_BOUNDS : undefined;
    },
    inputs,
  };
}

/** Take the arena's ships out of the world. */
export function clearArena(world: GameWorld, play: ArenaPlay): void {
  for (const { entity } of play.ships) world.remove(entity);
}
