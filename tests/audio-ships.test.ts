import { describe, expect, it } from 'vitest';
import { shipSchema } from '../data/schemas/ships';
import {
  PASSING_RANGE_M,
  SHIP_FOG_PERIOD_S,
  fogSignalCase,
  fogSignalPattern,
  passingPattern,
  passingSignal,
  whistleLevel,
  type MeetingInput,
} from '../src/audio/ship-whistle-mix';
import { signalLevel } from '../src/audio/world-mix';
import { NPC_RECORDS } from '../src/gameplay/npc-ships';
import { SHIP_RECORDS } from '../src/sim/sailing/ships';
import { SHIP_WHISTLES, foghorn, shipWhistle } from '../tools/audio/lib/synth';

const DEG = Math.PI / 180;

describe('NPC ship fog signals (plan 15 §4.3; Phase 3 piece J)', () => {
  it('gives every NPC class a whistle, and steamers a steam whistle, sail a fog horn', () => {
    for (const r of NPC_RECORDS) {
      expect(r.whistle, r.id).toBeDefined();
      expect(r.whistle?.kind).toBe(r.propulsion === 'steam' ? 'steam' : 'horn');
    }
    // Nobody can give a schooner a steam whistle.
    const barge = SHIP_RECORDS.find((r) => r.id === 'ship.schooner_barge');
    expect(
      shipSchema.safeParse({
        ...barge,
        whistle: { soundId: 'x', kind: 'steam', rangeM: 1000 },
      }).success,
    ).toBe(false);
    // The cutter has its own whistle, unlike any other ship's.
    const ids = NPC_RECORDS.map((r) => r.whistle?.soundId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('sounds three blasts a minute under steam, as the 1895 lakes rules ask', () => {
    expect(fogSignalCase('steam', 10, 0, 90 * DEG)).toBe('steam-under-way');
    const p = fogSignalPattern('steam-under-way');
    expect(p.pattern).toHaveLength(3);
    expect(p.periodS).toBeLessThanOrEqual(60);
    expect(SHIP_FOG_PERIOD_S).toBeLessThanOrEqual(60);
    // Distinct blasts: none overlap, and they're over well inside the cycle.
    for (let i = 1; i < p.pattern.length; i++) {
      const [prevAt, prevLen] = p.pattern[i - 1] as [number, number];
      expect((p.pattern[i] as [number, number])[0]).toBeGreaterThan(prevAt + prevLen);
    }
  });

  it('sounds a sailing vessel by its tack: one starboard, two port, three running', () => {
    // Heading north: wind from the east is over the starboard side.
    expect(fogSignalCase('horn', 6, 0, 60 * DEG)).toBe('starboard-tack');
    expect(fogSignalCase('horn', 6, 0, -60 * DEG)).toBe('port-tack');
    expect(fogSignalCase('horn', 6, 0, 160 * DEG)).toBe('running');
    expect(fogSignalPattern('starboard-tack').pattern).toHaveLength(1);
    expect(fogSignalPattern('port-tack').pattern).toHaveLength(2);
    expect(fogSignalPattern('running').pattern).toHaveLength(3);
  });

  it('rings the bell for about five seconds when stopped', () => {
    expect(fogSignalCase('steam', 0, 0, 0)).toBe('at-anchor');
    expect(fogSignalCase('horn', 0, 0, 0)).toBe('at-anchor');
    const bell = fogSignalPattern('at-anchor').pattern;
    expect(bell.length).toBeGreaterThan(8);
    const last = bell[bell.length - 1] as [number, number];
    expect(last[0]).toBeGreaterThan(4);
    expect(last[0]).toBeLessThan(6);
  });

  it('carries a whistle further than a fog horn, quieter and duller with distance', () => {
    const near = whistleLevel('steam', 6000, 1000) ?? { gain: 0, lowpassHz: 0 };
    const far = whistleLevel('steam', 6000, 4500, 0.5) ?? { gain: 1, lowpassHz: 1e6 };
    expect(far.gain).toBeLessThan(near.gain);
    expect(far.lowpassHz).toBeLessThan(near.lowpassHz);
    expect(whistleLevel('steam', 6000, 6000)).toBeUndefined();
    expect(whistleLevel('horn', 2000, 2500)).toBeUndefined();
    // A ship's whistle sits under the big lighthouse whistle at the same distance.
    expect(whistleLevel('steam', 6000, 1500)?.gain ?? 1).toBeLessThan(
      signalLevel('whistle', 1500)?.gain ?? 0,
    );
  });
});

describe('passing signals (Phase 3 piece J)', () => {
  const meet = (over: Partial<MeetingInput> = {}): MeetingInput => ({
    // The NPC steams north; you come south at it, a little to its port.
    ship: { x: 0, z: 0, headingRad: 0, speedKn: 10 },
    other: { x: -60, z: -800, headingRad: Math.PI },
    visibilityM: 20_000,
    ...over,
  });

  it('gives one blast for port to port, two for starboard to starboard', () => {
    expect(passingSignal(meet())).toBe(1);
    expect(passingSignal(meet({ other: { x: 0, z: -800, headingRad: Math.PI } }))).toBe(1);
    expect(passingSignal(meet({ other: { x: 300, z: -800, headingRad: Math.PI } }))).toBe(2);
    expect(passingPattern(1)).toHaveLength(1);
    expect(passingPattern(2)).toHaveLength(2);
  });

  it('stays quiet when not meeting: astern, far, out of sight, overtaking, or stopped', () => {
    expect(passingSignal(meet({ other: { x: 0, z: 800, headingRad: Math.PI } }))).toBeUndefined();
    expect(
      passingSignal(meet({ other: { x: 0, z: -(PASSING_RANGE_M + 100), headingRad: Math.PI } })),
    ).toBeUndefined();
    expect(passingSignal(meet({ visibilityM: 500 }))).toBeUndefined();
    expect(passingSignal(meet({ other: { x: 0, z: -800, headingRad: 0 } }))).toBeUndefined();
    expect(
      passingSignal(meet({ ship: { x: 0, z: 0, headingRad: 0, speedKn: 0 } })),
    ).toBeUndefined();
  });
});

describe('whistle synthesis (Phase 3 piece J)', () => {
  const RATE = 8000;
  /** The strongest frequency in the steady middle of a blast, by a plain DFT scan. */
  function peakHz(x: Float32Array, lo: number, hi: number): number {
    const start = Math.floor(x.length * 0.4);
    const n = 2048;
    let best = 0;
    let bestHz = 0;
    for (let hz = lo; hz <= hi; hz += 2) {
      let re = 0;
      let im = 0;
      for (let i = 0; i < n; i++) {
        const v = x[start + i] as number;
        re += v * Math.cos((2 * Math.PI * hz * i) / RATE);
        im += v * Math.sin((2 * Math.PI * hz * i) / RATE);
      }
      const m = re * re + im * im;
      if (m > best) {
        best = m;
        bestHz = hz;
      }
    }
    return bestHz;
  }

  it('pitches the freighter deep and the tug shrill, and fades both to silence', () => {
    const freighter = shipWhistle(RATE, SHIP_WHISTLES.freighter, 2, 1);
    const tug = shipWhistle(RATE, SHIP_WHISTLES.tug, 2, 1);
    expect(Math.abs(peakHz(freighter, 100, 400) - 138)).toBeLessThan(8);
    expect(Math.abs(peakHz(tug, 400, 800) - 587)).toBeLessThan(25);
    for (const x of [freighter, tug, foghorn(RATE, 1.5)]) {
      expect(Math.abs(x[x.length - 1] as number)).toBeLessThan(0.05);
      expect(x.every(Number.isFinite)).toBe(true);
    }
  });
});
