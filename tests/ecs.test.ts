import { describe, expect, it } from 'vitest';
import {
  cloneTransform,
  createGameWorld,
  interpolateTransform,
  snapshotTransforms,
  velocitySystem,
  type Transform,
} from '../src/gameplay/ecs';

describe('ECS', () => {
  it('moves entities by velocity and interpolates between ticks', () => {
    const world = createGameWorld();
    const transform: Transform = { position: { x: 0, y: 0, z: 0 }, heading: 0 };
    const ship = world.add({
      id: 'ship.player',
      transform,
      previousTransform: cloneTransform(transform),
      velocity: { x: 10, y: 0, z: 0 },
    });
    world.add({ id: 'buoy' });

    expect(world.with('velocity').entities).toEqual([ship]);

    snapshotTransforms(world);
    velocitySystem(world, 0.5);
    expect(ship.transform.position.x).toBe(5);

    const out: Transform = { position: { x: 0, y: 0, z: 0 }, heading: 0 };
    expect(interpolateTransform(ship, 0.5, out).position.x).toBe(2.5);
  });

  it('interpolates heading across north the short way', () => {
    const out: Transform = { position: { x: 0, y: 0, z: 0 }, heading: 0 };
    const e = {
      previousTransform: { position: { x: 0, y: 0, z: 0 }, heading: 2 * Math.PI - 0.1 },
      transform: { position: { x: 0, y: 0, z: 0 }, heading: 0.1 },
    };
    const h = interpolateTransform(e, 0.5, out).heading;
    expect(Math.cos(h)).toBeCloseTo(1);
  });
});
