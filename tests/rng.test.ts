import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';

describe('Rng', () => {
  it('is deterministic for a seed', () => {
    const a = Rng.fromSeed('superior');
    const b = Rng.fromSeed('superior');
    expect(Array.from({ length: 10 }, () => a.next())).toEqual(
      Array.from({ length: 10 }, () => b.next()),
    );
    expect(Rng.fromSeed('michigan').next()).not.toBe(Rng.fromSeed('superior').next());
  });

  it('continues the same sequence after a save and reload of its state', () => {
    fc.assert(
      fc.property(fc.string(), fc.nat({ max: 50 }), (seed, skip) => {
        const rng = Rng.fromSeed(seed);
        for (let i = 0; i < skip; i++) rng.next();
        const restored = Rng.fromState(JSON.parse(JSON.stringify(rng.getState())));
        expect(restored.nextUint32()).toBe(rng.nextUint32());
      }),
    );
  });

  it('keeps int() inside its inclusive bounds', () => {
    fc.assert(
      fc.property(
        fc.string(),
        fc.integer({ min: -1000, max: 1000 }),
        fc.nat(1000),
        (seed, min, span) => {
          const v = Rng.fromSeed(seed).int(min, min + span);
          expect(v).toBeGreaterThanOrEqual(min);
          expect(v).toBeLessThanOrEqual(min + span);
        },
      ),
    );
  });

  it('keeps next() in [0, 1) with a roughly uniform mean', () => {
    const rng = Rng.fromSeed('mean');
    let sum = 0;
    for (let i = 0; i < 100_000; i++) {
      const v = rng.next();
      expect(v >= 0 && v < 1).toBe(true);
      sum += v;
    }
    expect(sum / 100_000).toBeCloseTo(0.5, 2);
  });

  it('rejects empty picks and bad ranges', () => {
    const rng = Rng.fromSeed('x');
    expect(() => rng.pick([])).toThrow(RangeError);
    expect(() => rng.int(3, 1)).toThrow(RangeError);
  });
});
