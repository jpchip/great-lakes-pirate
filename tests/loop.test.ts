import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { createLoop, FixedStepper, MAX_FRAME_SECONDS, type LoopScheduler } from '../src/core/loop';

describe('FixedStepper', () => {
  it('runs one tick per 1/hz and carries the remainder as alpha', () => {
    const s = new FixedStepper(60);
    expect(s.advance(1 / 60)).toMatchObject({ ticks: 1 });
    const r = s.advance(1.5 / 60);
    expect(r.ticks).toBe(1);
    expect(r.alpha).toBeCloseTo(0.5);
    expect(s.advance(0.5 / 60).ticks).toBe(1);
  });

  it('clamps long frames so the simulation never spirals', () => {
    const s = new FixedStepper(60);
    expect(s.advance(10).ticks).toBe(Math.floor(MAX_FRAME_SECONDS * 60));
  });

  it('runs no ticks while paused', () => {
    const s = new FixedStepper(30);
    s.paused = true;
    expect(s.advance(1).ticks).toBe(0);
  });

  it('total ticks match total time for any frame sequence (no drift)', () => {
    fc.assert(
      fc.property(
        fc.array(fc.double({ min: 0, max: 0.2, noNaN: true }), { maxLength: 200 }),
        (frames) => {
          const s = new FixedStepper(60);
          let ticks = 0;
          for (const f of frames) ticks += s.advance(f).ticks;
          const total = frames.reduce((a, b) => a + b, 0);
          expect(Math.abs(ticks - total * 60)).toBeLessThanOrEqual(1 + 1e-6);
        },
      ),
    );
  });
});

describe('createLoop', () => {
  it('drives fixed ticks and one render per frame', () => {
    const callbacks: ((t: number) => void)[] = [];
    const scheduler: LoopScheduler = {
      request: (cb) => callbacks.push(cb),
      cancel: () => undefined,
    };
    const ticks: number[] = [];
    const frames: number[] = [];
    const loop = createLoop(
      { tick: (dt) => ticks.push(dt), frame: (alpha) => frames.push(alpha) },
      new FixedStepper(10),
      scheduler,
    );
    loop.start();
    callbacks.shift()?.(0);
    callbacks.shift()?.(250);
    expect(ticks).toHaveLength(2);
    expect(frames).toHaveLength(2);
    expect(frames[1]).toBeCloseTo(0.5);

    loop.setPaused(true);
    callbacks.shift()?.(500);
    expect(ticks).toHaveLength(2);
    expect(frames).toHaveLength(3);
  });
});
