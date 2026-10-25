import { describe, expect, it } from 'vitest';
import { directionFrom, TIMES_OF_DAY } from '../src/render/style/time-of-day';

describe('S4 lighting presets (plan 14 §3.2)', () => {
  it('points azimuths the way the world is laid out: north -z, east +x', () => {
    const north = directionFrom(0, 0);
    expect(north.z).toBeCloseTo(-1);
    const east = directionFrom(90, 0);
    expect(east.x).toBeCloseTo(1);
    expect(directionFrom(0, 90).y).toBeCloseTo(1);
  });

  it('keeps the dusk sun low in the west and the night moon above the horizon', () => {
    const dusk = TIMES_OF_DAY.dusk.keyDirection;
    expect(dusk.x).toBeLessThan(-0.9);
    expect(dusk.y).toBeGreaterThan(0);
    expect(dusk.y).toBeLessThan(0.15);
    expect(TIMES_OF_DAY.night.keyDirection.y).toBeGreaterThan(0.3);
  });

  it('makes fog close in well inside the haze distance', () => {
    for (const tod of Object.values(TIMES_OF_DAY)) {
      expect(tod.fog.far).toBeLessThan(tod.haze.far / 2);
      expect(tod.fog.near).toBeLessThan(tod.fog.far);
    }
  });
});
