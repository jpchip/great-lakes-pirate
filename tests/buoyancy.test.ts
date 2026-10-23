import { describe, expect, it } from 'vitest';
import { buoyancySystem, hullTargets, schoonerBuoyancy } from '../src/gameplay/buoyancy';
import { createGameWorld, type Transform } from '../src/gameplay/ecs';
import { createSea, type GerstnerWave, type Sea } from '../src/sim/weather/waves';

const flat = (): Sea => createSea([]);

/** One long swell traveling toward `direction`, so its slope is easy to reason about. */
function swell(direction: number): Sea {
  const wave: GerstnerWave = { amplitude: 1, wavelength: 120, direction, steepness: 0, phase: 0 };
  return createSea([wave]);
}

function ship(world = createGameWorld()) {
  const transform: Transform = { position: { x: 0, y: 0, z: 0 }, heading: 0 };
  return { world, entity: world.add({ transform, buoyancy: schoonerBuoyancy() }) };
}

describe('buoyancy', () => {
  it('floats level on a flat sea', () => {
    const { world, entity } = ship();
    for (let i = 0; i < 120; i++) buoyancySystem(world, flat(), 1 / 60);
    expect(entity.transform.position.y).toBe(0);
    expect(entity.transform.pitch).toBe(0);
    expect(entity.transform.roll).toBe(0);
  });

  it('pitches bow up on a slope rising ahead and rolls when it rises to starboard', () => {
    const b = schoonerBuoyancy();
    // Waves traveling south: at t = 0 near the origin the surface rises toward the south...
    const sea = swell(Math.PI);
    sea.time = 0;
    // ...so a ship heading south (π) sees the water rising ahead of it.
    const south = hullTargets(sea, b, 0, 0, Math.PI);
    expect(south.pitch).toBeGreaterThan(0.01);
    expect(Math.abs(south.roll)).toBeLessThan(1e-6);
    // Heading east, south is to starboard: starboard rises, so roll is positive.
    const east = hullTargets(sea, b, 0, 0, Math.PI / 2);
    expect(east.roll).toBeGreaterThan(0.01);
    expect(Math.abs(east.pitch)).toBeLessThan(1e-6);
  });

  it('settles onto a still target and stays bounded on a moving sea', () => {
    const { world, entity } = ship();
    const sea = createSea([
      { amplitude: 0.8, wavelength: 300, direction: 0, steepness: 0, phase: Math.PI / 2 },
    ]);
    // Freeze the sea at a crest: the hull should settle near the crest height.
    for (let i = 0; i < 60 * 20; i++) buoyancySystem(world, sea, 1 / 60);
    expect(entity.transform.position.y).toBeCloseTo(
      hullTargets(sea, entity.buoyancy, 0, 0, 0).heave,
      3,
    );

    const moving = createSea();
    let worst = 0;
    for (let i = 0; i < 60 * 60; i++) {
      moving.time += 1 / 60;
      buoyancySystem(world, moving, 1 / 60);
      worst = Math.max(
        worst,
        Math.abs(entity.transform.roll ?? 0),
        Math.abs(entity.transform.pitch ?? 0),
      );
    }
    // A moderate chop should move a 30 m schooner by a few degrees, not tens.
    expect(worst).toBeGreaterThan(0.002);
    expect(worst).toBeLessThan(0.2);
  });

  it('is deterministic', () => {
    const run = (): number[] => {
      const { world, entity } = ship();
      const sea = createSea();
      const out: number[] = [];
      for (let i = 0; i < 600; i++) {
        sea.time += 1 / 60;
        buoyancySystem(world, sea, 1 / 60);
        out.push(
          entity.transform.position.y,
          entity.transform.pitch ?? 0,
          entity.transform.roll ?? 0,
        );
      }
      return out;
    };
    expect(run()).toEqual(run());
  });
});
