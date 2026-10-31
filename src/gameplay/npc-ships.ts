import type { ShipRecord } from '../../data/schemas/ships';
import { DEFAULT_COMPRESSION, knotsToMs, sceneSpeed } from '../core/coords';
import { R_SAILING } from '../core/time';
import { SHIP_RECORDS } from '../sim/sailing/ships';
import { createBuoyancy } from './buoyancy';
import { cloneTransform, type Entity } from './ecs';

/**
 * NPC ships in a zone (Phase 3 piece H): a traffic class from ships.json holding a course
 * at its service speed, riding the swell on its record's buoyancy. In an arena,
 * gameplay/arena steers them (piece G); in a zone they steam straight on.
 */

/** Every traffic class, in ships.json order. */
export const NPC_RECORDS: readonly ShipRecord[] = SHIP_RECORDS.filter((r) => r.role === 'npc');

/** A class's service speed, game knots: the engine speed, or a schooner-barge under tow. */
export function serviceSpeedKn(record: ShipRecord): number {
  return record.propulsion === 'steam' ? record.engineSpeedKn : record.hullMaxSpeedKn;
}

export function createNpcShipEntity(
  record: ShipRecord,
  x: number,
  z: number,
  heading: number,
  speedKn = serviceSpeedKn(record),
): Entity {
  const transform = { position: { x, y: 0, z }, heading };
  const v = sceneSpeed(knotsToMs(speedKn), R_SAILING, DEFAULT_COMPRESSION);
  return {
    id: `npc.${record.id.replace(/^ship\./, '')}`,
    transform,
    previousTransform: cloneTransform(transform),
    // Heading is clockwise from north; zone z points south.
    velocity: { x: Math.sin(heading) * v, y: 0, z: -Math.cos(heading) * v },
    buoyancy: createBuoyancy(record.buoyancy),
    model: 'npc',
    npc: { classId: record.id, speedKn },
  };
}

export type ParadeMode = 'ahead' | 'stop' | 'meet';

/**
 * `?npcs` (a dev check): one of each class in a line abreast ahead of the player, on the
 * player's heading; places too shallow for a class are skipped. `?npcs=stop` lays them
 * to, and `?npcs=meet` brings them toward the player on the reciprocal (bows and
 * sidelights on).
 */
export function npcParade(
  player: { x: number; z: number; heading: number },
  depthAt: (x: number, z: number) => number,
  mode: ParadeMode,
): Entity[] {
  const ahead = mode === 'meet' ? 700 : 260;
  const spacing = 150;
  const out: Entity[] = [];
  NPC_RECORDS.forEach((record, i) => {
    const across = (i - (NPC_RECORDS.length - 1) / 2) * spacing;
    const fx = Math.sin(player.heading);
    const fz = -Math.cos(player.heading);
    const x = player.x + fx * ahead - fz * across;
    const z = player.z + fz * ahead + fx * across;
    if (depthAt(x, z) < record.draftFullM + 1) return;
    const heading = mode === 'meet' ? player.heading + Math.PI : player.heading;
    out.push(createNpcShipEntity(record, x, z, heading, mode === 'stop' ? 0 : undefined));
  });
  return out;
}
