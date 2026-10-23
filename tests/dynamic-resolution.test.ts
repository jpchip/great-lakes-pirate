import { describe, expect, it } from 'vitest';
import { DynamicResolution } from '../src/render/dynamic-resolution';

const target = 1000 / 60;

function feed(dr: DynamicResolution, ms: number, frames: number): void {
  for (let i = 0; i < frames; i++) dr.update(ms);
}

describe('DynamicResolution', () => {
  it('starts at the top of the range and steps down while frames run long', () => {
    const dr = new DynamicResolution({ min: 0.6, max: 0.75, targetMs: target });
    expect(dr.scale).toBe(0.75);
    feed(dr, 33, 400);
    expect(dr.scale).toBe(0.6);
  });

  it('never leaves its range', () => {
    const dr = new DynamicResolution({ min: 0.85, max: 1, targetMs: target });
    feed(dr, 100, 1000);
    expect(dr.scale).toBe(0.85);
    feed(dr, 5, 5000);
    expect(dr.scale).toBe(1);
  });

  it('probes back up after a stretch on budget', () => {
    const dr = new DynamicResolution({ min: 0.6, max: 1, targetMs: target, probeFrames: 60 });
    feed(dr, 40, 200);
    const low = dr.scale;
    expect(low).toBeLessThan(1);
    feed(dr, target, 400);
    expect(dr.scale).toBeGreaterThan(low);
  });

  it('waits longer before probing again after a failed probe', () => {
    const dr = new DynamicResolution({
      min: 0.5,
      max: 1,
      targetMs: target,
      probeFrames: 60,
      settleFrames: 10,
      smoothing: 1,
    });
    feed(dr, 40, 20); // one step down to 0.95
    const settled = dr.scale;
    feed(dr, target, 70); // settle, then probe up
    expect(dr.scale).toBeGreaterThan(settled);
    feed(dr, 40, 11); // the probe fails straight away
    expect(dr.scale).toBe(settled);
    feed(dr, target, 80); // the old interval is no longer enough
    expect(dr.scale).toBe(settled);
    feed(dr, target, 60);
    expect(dr.scale).toBeGreaterThan(settled);
  });

  it('holds still when disabled and resets on configure', () => {
    const dr = new DynamicResolution({ min: 0.6, max: 1, targetMs: target });
    dr.enabled = false;
    feed(dr, 50, 300);
    expect(dr.scale).toBe(1);
    dr.configure(0.6, 0.75, 1000 / 30);
    expect(dr.scale).toBe(0.75);
  });

  it('ignores junk frame times', () => {
    const dr = new DynamicResolution({ min: 0.6, max: 1, targetMs: target });
    expect(dr.update(Number.NaN)).toBe(false);
    expect(dr.update(-1)).toBe(false);
    expect(dr.update(Number.POSITIVE_INFINITY)).toBe(false);
    expect(dr.frameMs).toBe(0);
  });
});
