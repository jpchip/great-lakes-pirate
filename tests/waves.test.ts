import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  GAMEPLAY_WAVES,
  MAX_TOTAL_STEEPNESS,
  MAX_WAVES,
  displacementAt,
  heightAt,
  packWaves,
  testBaySea,
  writeWaveUniforms,
} from '../src/sim/weather/waves';

const coord = fc.double({ min: -2000, max: 2000, noNaN: true });
const time = fc.double({ min: 0, max: 3600, noNaN: true });

describe('Gerstner wave set', () => {
  it('caps the summed steepness so crests never loop', () => {
    for (const scale of [0.5, 1, 2, 5]) {
      const total = packWaves(testBaySea(scale)).reduce((s, w) => s + w.steepness, 0);
      expect(total).toBeLessThanOrEqual(MAX_TOTAL_STEEPNESS + 1e-9);
    }
  });

  it('travels in the compass direction it is given', () => {
    const [east] = packWaves([
      { amplitude: 1, wavelength: 20, direction: Math.PI / 2, steepness: 0, phase: 0 },
    ]);
    expect(east?.dx).toBeCloseTo(1);
    expect(east?.dz).toBeCloseTo(0);
    const [south] = packWaves([
      { amplitude: 1, wavelength: 20, direction: Math.PI, steepness: 0, phase: 0 },
    ]);
    expect(south?.dz).toBeCloseTo(1);
  });

  it('uses deep-water dispersion: a 34 m wave crests about every 4.7 s', () => {
    const [w] = packWaves([{ amplitude: 1, wavelength: 34, direction: 0, steepness: 0, phase: 0 }]);
    expect((2 * Math.PI) / (w?.omega ?? 0)).toBeCloseTo(4.67, 1);
  });

  it('stays within the summed amplitude', () => {
    const waves = packWaves(testBaySea());
    const bound = waves.reduce((s, w) => s + w.amplitude, 0);
    fc.assert(
      fc.property(coord, coord, time, (x, z, t) => {
        expect(Math.abs(heightAt(waves, MAX_WAVES, x, z, t))).toBeLessThanOrEqual(bound + 1e-9);
      }),
    );
  });

  it('finds the height of the surface point that lands on the query position', () => {
    const waves = packWaves(testBaySea(1.5));
    fc.assert(
      fc.property(coord, coord, time, (x, z, t) => {
        const h = heightAt(waves, GAMEPLAY_WAVES, x, z, t);
        // Re-solve the rest position and check it really displaces onto (x, z).
        let x0 = x;
        let z0 = z;
        for (let i = 0; i < 200; i++) {
          const d = displacementAt(waves, GAMEPLAY_WAVES, x0, z0, t);
          x0 = x - d.dx;
          z0 = z - d.dz;
        }
        const d = displacementAt(waves, GAMEPLAY_WAVES, x0, z0, t);
        expect(x0 + d.dx).toBeCloseTo(x, 3);
        expect(z0 + d.dz).toBeCloseTo(z, 3);
        expect(Math.abs(h - d.dy)).toBeLessThan(0.01);
      }),
    );
  });

  it('gives gameplay the same height on every preset', () => {
    const waves = packWaves(testBaySea());
    const at4 = heightAt(waves, GAMEPLAY_WAVES, 12, -7, 3.2);
    expect(heightAt(waves.slice(0, 6), GAMEPLAY_WAVES, 12, -7, 3.2)).toBe(at4);
  });

  it('packs the uniforms the shader reads', () => {
    const waves = packWaves(testBaySea());
    const a = new Float32Array(MAX_WAVES * 4);
    const b = new Float32Array(MAX_WAVES * 4);
    writeWaveUniforms(waves.slice(0, 2), a, b);
    const w1 = waves[1];
    expect(Array.from(a.slice(4, 8))).toEqual(
      [w1?.dx, w1?.dz, w1?.k, w1?.amplitude].map((v) => Math.fround(v ?? NaN)),
    );
    expect(b[4]).toBeCloseTo(w1?.omega ?? NaN);
    expect(b[6]).toBeCloseTo(w1?.steepness ?? NaN);
    expect(a.slice(8).every((v) => v === 0)).toBe(true);
  });

  it('rejects more waves than the shader holds', () => {
    const many = [...testBaySea(), ...testBaySea()];
    expect(() => packWaves(many)).toThrow(RangeError);
  });
});
