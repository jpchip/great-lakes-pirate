import { describe, expect, it } from 'vitest';
import {
  CHART_MUSIC_DELAY_S,
  CHART_SOUND,
  ChartCues,
  ChartMusic,
  STINGER_DUCK_LEVEL,
  stingerFor,
} from '../src/audio/chart-audio';
import type { AudioMixer, OneShot } from '../src/audio/mixer';
import type { MusicPlayer } from '../src/audio/music';
import {
  REACH,
  STINGERS,
  chartTheme,
  drumHit,
  fogFade,
  reachForm,
  stinger,
} from '../tools/audio/lib/synth-chart';
import { peak, seeded } from '../tools/audio/lib/synth';

interface FakePlayer extends MusicPlayer {
  plays: number;
  stops: number;
  level: number;
  fadeIn: number;
}

function fakePlayer(): FakePlayer {
  let playing = false;
  return {
    plays: 0,
    stops: 0,
    level: 1,
    fadeIn: 0,
    play(fadeInS = 0) {
      this.plays++;
      this.level = 1;
      this.fadeIn = fadeInS;
      playing = true;
    },
    stop() {
      this.stops++;
      playing = false;
    },
    setLevel(v: number) {
      this.level = v;
    },
    get playing() {
      return playing;
    },
  };
}

describe('encounter stingers (plan 15 §6.1, Phase 3 piece J)', () => {
  it('picks a stinger by what the lookout saw', () => {
    const c = { hostile: false, forced: false };
    expect(stingerFor({ ...c, kind: 'freighter' })).toBe('sail');
    expect(stingerFor({ ...c, kind: 'steamer' })).toBe('sail');
    expect(stingerFor({ ...c, kind: 'tug' })).toBe('sail');
    expect(stingerFor({ ...c, kind: 'storm' })).toBe('squall');
    expect(stingerFor({ ...c, kind: 'derelict' })).toBe('derelict');
    expect(stingerFor({ kind: 'cutter', hostile: true, forced: false })).toBe('threat');
    expect(stingerFor({ kind: 'cutter', hostile: true, forced: true })).toBe('hunted');
  });

  it('plays a stinger on the music bus and ducks the theme for its length', () => {
    const shots: OneShot[] = [];
    const mixer = { play: (s: OneShot) => void shots.push(s) } as unknown as AudioMixer;
    const buffer = { duration: 3 } as AudioBuffer;
    const bank = new Map([
      [CHART_SOUND.stinger.sail, buffer],
      [CHART_SOUND.transition, { duration: 4 } as AudioBuffer],
    ]);
    const player = fakePlayer();
    const music = new ChartMusic(player);
    const cues = new ChartCues(mixer, bank, music);
    music.update(CHART_MUSIC_DELAY_S + 0.1, true);
    cues.stinger('sail');
    expect(shots[0]?.bus).toBe('music');
    expect(cues.last).toBe('sail');
    music.update(0.1, true);
    expect(player.level).toBe(STINGER_DUCK_LEVEL);
    music.update(3, true);
    expect(player.level).toBe(1);
    // A stinger the bank doesn't have stays quiet.
    cues.stinger('hunted');
    expect(shots).toHaveLength(1);
    cues.transition();
    expect(shots[1]?.bus).toBe('ui');
  });
});

describe('chart music (plan 15 §6.1 "Chart travel")', () => {
  it('starts after the chart has been open a moment, and fades when it closes', () => {
    const player = fakePlayer();
    const music = new ChartMusic(player);
    music.update(1, false);
    expect(player.plays).toBe(0);
    // A quick look at the chart stays quiet.
    music.update(CHART_MUSIC_DELAY_S * 0.6, true);
    music.update(0.1, false);
    expect(player.plays).toBe(0);
    music.update(CHART_MUSIC_DELAY_S * 0.6, true);
    music.update(CHART_MUSIC_DELAY_S * 0.6, true);
    expect(player.plays).toBe(1);
    expect(player.fadeIn).toBeGreaterThan(0);
    // It loops on while the chart stays open: no restart.
    music.update(500, true);
    expect(player.plays).toBe(1);
    music.update(0.1, false);
    expect(player.stops).toBe(1);
    expect(music.playing).toBe(false);
  });

  it('stays silent without a cue', () => {
    const music = new ChartMusic(undefined);
    music.update(10, true);
    expect(music.playing).toBe(false);
  });
});

describe('chart audio synthesis', () => {
  const RATE = 8000;

  it('fits "The Long Reach" to whole 6/8 bars, one chord a bar', () => {
    const { concertina, whistle, chords } = reachForm();
    const bars = (notes: readonly (readonly [string, number])[]): number =>
      notes.reduce((s, [, b]) => s + b, 0) / REACH.beatsPerBar;
    expect(Number.isInteger(bars(REACH.a))).toBe(true);
    expect(Number.isInteger(bars(REACH.b))).toBe(true);
    expect(bars(concertina)).toBe(34);
    expect(bars(whistle)).toBe(chords.length);
    expect(chords).toHaveLength(42);
  });

  it('renders the theme to about a minute and a half', () => {
    const theme = chartTheme(RATE);
    const seconds = theme.length / RATE;
    expect(seconds).toBeGreaterThan(80);
    expect(seconds).toBeLessThan(100);
    expect(peak(theme)).toBeGreaterThan(0.05);
  }, 60_000);

  it('renders each stinger as a few seconds of sound', () => {
    for (const name of STINGERS) {
      const s = stinger(name, RATE);
      expect(s.length / RATE, name).toBeGreaterThan(2);
      expect(s.length / RATE, name).toBeLessThan(6);
      expect(peak(s), name).toBeGreaterThan(0.01);
    }
  }, 60_000);

  it('drops a drum stroke in pitch and lets it die away', () => {
    const hit = drumHit(RATE, seeded(1));
    const early = peak(hit.slice(0, RATE * 0.05));
    const late = peak(hit.slice(RATE * 0.55));
    expect(late).toBeLessThan(early * 0.2);
  });

  it('swells the fade to fog in and lets it die away', () => {
    const fade = fogFade(RATE);
    expect(fade.length / RATE).toBeCloseTo(4, 1);
    const first = peak(fade.slice(0, RATE * 0.1));
    const middle = peak(fade.slice(RATE * 0.8, RATE * 1.4));
    const last = peak(fade.slice(fade.length - RATE * 0.05));
    expect(middle).toBeGreaterThan(first * 3);
    expect(last).toBeLessThan(middle * 0.2);
  });
});
