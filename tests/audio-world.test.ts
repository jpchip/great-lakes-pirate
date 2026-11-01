import { describe, expect, it } from 'vitest';
import { fogSignalSchema } from '../data/schemas/lighthouses';
import { DUCK_LEVEL, MusicDirector, type MusicPlayer } from '../src/audio/music';
import {
  NEAR_THUNDER_M,
  SIGNAL_RANGE_M,
  blastsBetween,
  daylight,
  fogAmount,
  fogMix,
  gullRate,
  loonRate,
  musicMood,
  rainMix,
  signalLevel,
  signalPhase,
  thunderShot,
  type GullInput,
  type LoonInput,
} from '../src/audio/world-mix';
import { LIGHTHOUSES } from '../src/sim/lighthouses';
import { fogBell, fogWhistle, noteHz, pluckNote, seeded } from '../tools/audio/lib/synth';

describe('weather sounds (plan 15 §4.1)', () => {
  it('rains louder and brighter as it rains harder, and not at all when dry', () => {
    expect(rainMix(0, 0).gain).toBe(0);
    const drizzle = rainMix(0.2, 0);
    const downpour = rainMix(0.9, 0);
    expect(downpour.gain).toBeGreaterThan(drizzle.gain);
    expect(downpour.cutoffHz).toBeGreaterThan(drizzle.cutoffHz);
    expect(rainMix(0.9, 1).gain).toBeGreaterThan(downpour.gain);
  });

  it('hears fog only once it closes in, and damps distant sounds in it', () => {
    expect(fogAmount(20_000)).toBe(0);
    expect(fogAmount(4000)).toBe(0);
    expect(fogAmount(300)).toBe(1);
    const thick = fogMix(400, 3);
    expect(thick.hushGain).toBeGreaterThan(0.15);
    expect(thick.dripsPerS).toBeGreaterThan(0.5);
    expect(thick.damping).toBeLessThan(0.6);
    // A breeze through the fog drowns the drips.
    expect(fogMix(400, 20).dripsPerS).toBeLessThan(thick.dripsPerS);
    expect(fogMix(15_000, 3)).toEqual({ hushGain: 0, dripsPerS: 0, damping: 1 });
  });

  it('delays thunder about 3 s a kilometer, quieter and duller with distance', () => {
    const near = thunderShot(1000, true);
    const far = thunderShot(6000, true);
    expect(near.near).toBe(true);
    expect(far.near).toBe(false);
    expect(thunderShot(NEAR_THUNDER_M + 1, true).near).toBe(false);
    expect(near.delayS).toBeCloseTo(2.92, 2);
    expect(far.delayS).toBeCloseTo(17.5, 1);
    expect(far.gain).toBeLessThan(near.gain);
    expect(far.lowpassHz).toBeLessThan(near.lowpassHz);
    expect(near.gain).toBeLessThanOrEqual(1);
    // A strike that stays in the cloud rumbles softer.
    expect(thunderShot(1000, false).gain).toBeLessThan(near.gain);
  });
});

describe('fog signals (plan 15 §4.3)', () => {
  const outer = LIGHTHOUSES.find((l) => l.id === 'light.outer');

  it('gives the stations signals in the data, each with its own rhythm', () => {
    const withSignals = LIGHTHOUSES.filter((l) => l.fogSignal);
    expect(withSignals.map((l) => l.id).sort()).toEqual([
      'light.duluth_south_pier',
      'light.lapointe',
      'light.outer',
      'light.raspberry',
      'light.superior_entry',
      'light.two_harbors',
    ]);
    // A dark station keeps no signal.
    expect(LIGHTHOUSES.filter((l) => !l.lit && l.fogSignal)).toEqual([]);
    const rhythms = new Set(withSignals.map((l) => JSON.stringify(l.fogSignal)));
    expect(rhythms.size).toBe(withSignals.length);
    expect(outer?.fogSignal?.kind).toBe('whistle');
  });

  it('rejects a blast that runs past its period', () => {
    const bad = { kind: 'bell', pattern: [[18, 4]], periodS: 20, confidence: 'unknown' };
    expect(fogSignalSchema.safeParse(bad).success).toBe(false);
  });

  it('lists every blast in a window, cycle after cycle', () => {
    const signal = {
      pattern: [
        [0, 2.5],
        [3, 2.5],
      ] as [number, number][],
      periodS: 20,
    };
    const blasts = blastsBetween(signal, 5, 0, 60);
    expect(blasts.map((b) => b.startS)).toEqual([5, 8, 25, 28, 45, 48]);
    // Windows that tile the timeline see each blast exactly once.
    const tiled = [0, 13, 25, 25.5, 48, 60].flatMap((from, i, a) =>
      i + 1 < a.length ? blastsBetween(signal, 5, from, a[i + 1] as number) : [],
    );
    expect(tiled.map((b) => b.startS)).toEqual([5, 8, 25, 28, 45, 48]);
    expect(blastsBetween(signal, 5, 10, 10)).toEqual([]);
  });

  it('gives each station a steady phase of its own', () => {
    const a = signalPhase('light.outer', 30);
    expect(a).toBe(signalPhase('light.outer', 30));
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThan(30);
    expect(signalPhase('light.raspberry', 30)).not.toBe(a);
  });

  it('carries a whistle farther than a bell, fading out at the edge of its range', () => {
    expect(signalLevel('bell', 3000)).toBeUndefined();
    expect(signalLevel('whistle', 3000)).toBeDefined();
    expect(signalLevel('whistle', SIGNAL_RANGE_M.whistle)).toBeUndefined();
    const level = (d: number, damping = 1): { gain: number; lowpassHz: number } =>
      signalLevel('whistle', d, damping) ?? { gain: NaN, lowpassHz: NaN };
    const close = level(400);
    const mid = level(3000);
    const edge = level(SIGNAL_RANGE_M.whistle - 50);
    expect(close.gain).toBeGreaterThan(mid.gain);
    expect(mid.gain).toBeGreaterThan(edge.gain);
    expect(edge.gain).toBeLessThan(0.02);
    expect(mid.lowpassHz).toBeLessThan(close.lowpassHz);
    // Fog dulls it further.
    expect(level(3000, 0.5).lowpassHz).toBeLessThan(mid.lowpassHz);
  });
});

describe('gulls and loons (plan 15 §4.1)', () => {
  const noon: GullInput = {
    sunElevationDeg: 50,
    shoreDistanceM: 3000,
    harborDistanceM: 10_000,
    windKn: 10,
    rain01: 0,
    storm01: 0,
  };

  it('has gulls by day, most at the harbors, fewest far out, none at night', () => {
    const open = gullRate(noon);
    const shore = gullRate({ ...noon, shoreDistanceM: 100 });
    const harbor = gullRate({ ...noon, shoreDistanceM: 100, harborDistanceM: 200 });
    expect(open).toBeGreaterThan(0);
    expect(shore).toBeGreaterThan(open * 3);
    expect(harbor).toBeGreaterThan(shore);
    expect(gullRate({ ...noon, sunElevationDeg: -15 })).toBe(0);
    expect(daylight(-15)).toBe(0);
    expect(daylight(30)).toBe(1);
  });

  it('quiets the birds in a gale or a downpour', () => {
    const fair = gullRate({ ...noon, shoreDistanceM: 100 });
    expect(gullRate({ ...noon, shoreDistanceM: 100, windKn: 40 })).toBe(0);
    expect(gullRate({ ...noon, shoreDistanceM: 100, rain01: 1 })).toBeLessThan(fair / 3);
  });

  const dusk: LoonInput = {
    sunElevationDeg: -3,
    month0: 5,
    shoreDistanceM: 800,
    windKn: 4,
    rain01: 0,
    storm01: 0,
  };

  it('has loons at dusk and at night on calm summer water', () => {
    const atDusk = loonRate(dusk);
    expect(atDusk).toBeGreaterThan(loonRate({ ...dusk, sunElevationDeg: 45 }) * 10);
    expect(loonRate({ ...dusk, sunElevationDeg: -20 })).toBeGreaterThan(atDusk / 3);
    expect(loonRate({ ...dusk, windKn: 25 })).toBe(0);
    // Gone by winter, thinning in autumn.
    expect(loonRate({ ...dusk, month0: 0 })).toBe(0);
    expect(loonRate({ ...dusk, month0: 10 })).toBeLessThan(atDusk / 5);
  });
});

describe('open-water music (plan 15 §6)', () => {
  const fair = { sunElevationDeg: 30, fogVisibilityM: 20_000, windKn: 12, rain01: 0, storm01: 0 };

  it('picks the waltz by day, the air at night, and nothing in fog or a storm', () => {
    expect(musicMood(fair)).toBe('day');
    expect(musicMood({ ...fair, sunElevationDeg: -12 })).toBe('night');
    expect(musicMood({ ...fair, fogVisibilityM: 800 })).toBe('quiet');
    expect(musicMood({ ...fair, storm01: 0.6 })).toBe('quiet');
    expect(musicMood({ ...fair, windKn: 35 })).toBe('quiet');
  });

  function fakePlayer(): MusicPlayer & {
    plays: number;
    stops: number;
    level: number;
    end(): void;
  } {
    let playing = false;
    return {
      plays: 0,
      stops: 0,
      level: 1,
      play() {
        this.plays++;
        this.level = 1;
        playing = true;
      },
      stop() {
        this.stops++;
        playing = false;
      },
      setLevel(v) {
        this.level = v;
      },
      end() {
        playing = false;
      },
      get playing() {
        return playing;
      },
    };
  }

  it('waits, plays a cue whole, then leaves a long silence', () => {
    const day = fakePlayer();
    const music = new MusicDirector({
      players: { day },
      random: () => 0.5,
      firstWaitS: [10, 10],
      gapS: [100, 100],
    });
    music.setActive(true);
    music.update(9, 'day', false);
    expect(day.plays).toBe(0);
    music.update(2, 'day', false);
    expect(day.plays).toBe(1);
    expect(music.current).toBe('day');
    day.end();
    music.update(1, 'day', false);
    expect(music.current).toBeUndefined();
    music.update(99, 'day', false);
    expect(day.plays).toBe(1);
    music.update(2, 'day', false);
    expect(day.plays).toBe(2);
  });

  it('fades out when fog rolls in, ducks under fog signals, and stops off the water', () => {
    const day = fakePlayer();
    const music = new MusicDirector({ players: { day }, random: () => 0, firstWaitS: [0, 0] });
    music.setActive(true);
    music.update(0.1, 'day', false);
    expect(day.plays).toBe(1);
    music.update(0.1, 'day', true);
    expect(day.level).toBe(DUCK_LEVEL);
    music.update(0.1, 'day', false);
    expect(day.level).toBe(1);
    music.update(0.1, 'quiet', false);
    expect(day.stops).toBe(1);
    expect(music.current).toBeUndefined();
    // Nothing starts while it stays quiet.
    music.update(1000, 'quiet', false);
    expect(day.plays).toBe(1);

    music.playNow('day');
    music.setActive(false);
    expect(day.stops).toBe(2);
    music.update(1000, 'day', false);
    expect(day.plays).toBe(2);
  });
});

describe('synthesized sources (tools/audio/lib/synth.ts)', () => {
  const RATE = 16000;

  it('tunes notes to A4 = 440 Hz', () => {
    expect(noteHz('A4')).toBe(440);
    expect(noteHz('A5')).toBe(880);
    expect(noteHz('C#5')).toBeCloseTo(554.37, 1);
    expect(noteHz('Bb3')).toBeCloseTo(233.08, 1);
    expect(() => noteHz('H2')).toThrow();
  });

  it('plucks a string at its pitch', () => {
    const x = pluckNote(220, 0.6, RATE, seeded(3));
    let best = 0;
    let bestLag = 0;
    for (let lag = 50; lag < 100; lag++) {
      let s = 0;
      for (let i = 1600; i < 8000; i++) s += (x[i] as number) * (x[i + lag] as number);
      if (s > best) [best, bestLag] = [s, lag];
    }
    expect(RATE / bestLag).toBeGreaterThan(215);
    expect(RATE / bestLag).toBeLessThan(225);
  });

  it('lets every string ring down, never up, across the guitar range', () => {
    for (let hz = 80; hz < 800; hz *= 1.05) {
      const x = pluckNote(hz, 2, RATE, seeded(5));
      const peakIn = (from: number, to: number): number =>
        Math.max(...Array.from(x.slice(from * RATE, to * RATE)).map(Math.abs));
      expect(peakIn(1.5, 1.9), `${hz.toFixed(0)} Hz`).toBeLessThan(peakIn(0, 0.2));
    }
  });

  it('renders the same signals from the same seed, and they ring down', () => {
    const a = fogBell(RATE, 6, 7);
    expect(fogBell(RATE, 6, 7)).toEqual(a);
    const tail = (x: Float32Array): number =>
      Math.max(...Array.from(x.slice(x.length - 200)).map(Math.abs));
    expect(tail(a)).toBeLessThan(Math.max(...Array.from(a).map(Math.abs)) / 3);
    const whistle = fogWhistle(RATE, 2);
    expect(whistle.length).toBe(2 * RATE);
    expect(Math.abs(whistle[whistle.length - 1] as number)).toBeLessThan(0.05);
  });
});
